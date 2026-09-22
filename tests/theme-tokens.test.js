import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemanticTheme, contrastRatio, contrastText, luminance } from '../src/lib/theme-tokens.js';
import { themePresets } from '../src/lib/theme-presets.js';
import { normalizeUserUiPreferences, validateUserUiPreferencePatch } from '../src/lib/user-ui-preferences.js';

const surfaces = ['--card', '--surface-raised', '--muted', '--input-surface', '--surface-hover', '--surface-selected', '--data-view-header-cell', '--data-view-row', '--data-view-row-alt'];

test('preset order, stable IDs and existing saved colour seeds remain compatible', () => {
  assert.deepEqual(themePresets.map(({ id }) => id), [
    'elset', 'midnight-signal', 'copper-dawn', 'evergreen-ledger',
    'studio-rose', 'desert-circuit', 'harbour-steel', 'alpine-frost',
  ]);
  const keys = ['pageBackgroundStart', 'pageBackgroundEnd', 'sidebarSurface', 'sidebarHeader', 'sidebarActive', 'heroSurface', 'actionColor', 'borderColor', 'dialogSurface', 'dataViewSurface', 'dataViewAccent'];
  // Compatibility fixtures from the six previously available presets.
  const saved = {
    elset: '#0F90CD #0F90CD #FFFFFF #0F90CD #F69320 #0F90CD #F69320 #1E293B #9FE4FB #EAF7FB #0F90CD',
    'midnight-signal': '#080D16 #0A101B #111827 #132A43 #1B436F #111827 #1469B8 #34465E #162235 #101826 #5F87A5',
    'copper-dawn': '#FFF1E7 #F3BA8D #EED7C5 #8A3C22 #F58A4B #A94A24 #E6632B #5A2F20 #F6E5D7 #F1DECD #C96C33',
    'evergreen-ledger': '#EEF7E8 #B4D29B #D3E3CE #22492D #6BAE58 #2E603A #80C24D #23422B #E5EEDD #DFEADA #5E8F51',
    'studio-rose': '#FFF1F5 #F4BCCB #E8CFDA #7A2D4F #E36D97 #95395E #D94C7F #61263F #F4E2E9 #EFDBE3 #D94C7F',
    'desert-circuit': '#FFF6DB #E7C56D #E7D8B7 #5A4718 #C9901E #7A5C12 #DE7E12 #4A3915 #F3E8CF #EEE1C3 #D4932A',
  };
  for (const [id, colours] of Object.entries(saved)) {
    const values = Object.fromEntries(colours.split(' ').map((value, index) => [keys[index], value]));
    assert.deepEqual(themePresets.find(preset => preset.id === id).values, values);
    const loaded = normalizeUserUiPreferences(values);
    assert.deepEqual(Object.fromEntries(keys.map(key => [key, loaded[key]])), values);
  }
  const defaults = normalizeUserUiPreferences();
  assert.deepEqual(Object.fromEntries(keys.map(key => [key, defaults[key]])), themePresets[0].values);
});

for (const preset of themePresets) {
  test(`${preset.label}: readable text, complete surfaces and business status contrast`, () => {
    const { vars: v, dark } = buildSemanticTheme(preset.values);
    assert.equal(dark, preset.id === 'midnight-signal');
    assert.equal(new Set(['--background', '--card', '--surface-raised', '--muted', '--input-surface'].map(key => v[key])).size, 5);
    for (const bg of surfaces) for (const fg of ['--foreground', '--text-secondary', '--muted-foreground']) {
      assert.ok(contrastRatio(v[fg], v[bg]) >= 4.5, `${fg} on ${bg}`);
    }
    for (const [bg, fg] of [['--primary', '--primary-foreground'], ['--primary-hover', '--primary-foreground'], ['--popover', '--popover-foreground'], ['--sidebar', '--sidebar-foreground'], ['--sidebar', '--sidebar-muted'], ['--sidebar-primary', '--sidebar-primary-foreground'], ['--sidebar-primary', '--sidebar-primary-muted'], ['--sidebar-header', '--sidebar-header-muted'], ['--workspace-hero-bg', '--workspace-hero-text'], ['--workspace-hero-bg', '--workspace-hero-muted']]) {
      assert.ok(contrastRatio(v[bg], v[fg]) >= 4.5, `${fg} on ${bg}`);
    }
    for (const name of ['info', 'success', 'warning', 'danger', 'maintenance', 'special']) {
      assert.ok(contrastRatio(v[`--status-${name}`], v[`--status-${name}-surface`]) >= 4.5, name);
    }
    if (dark) for (const key of [...surfaces, '--background', '--popover', '--dialog-surface']) assert.ok(luminance(v[key]) < 0.07, `${key} must stay dark`);
    // Every preset is a valid patch in the existing per-account schema.
    assert.deepEqual(validateUserUiPreferencePatch(preset.values), preset.values);
  });
}

test('custom foreground selection uses WCAG luminance, including mid-tone colours', () => {
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const bg = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    assert.ok(contrastRatio(bg, contrastText(bg)) >= 4.5, bg);
  }
});

test('old records derive missing tokens without altering custom preferences', () => {
  const prefs = normalizeUserUiPreferences({ actionColor: '#abc', dataViewSurface: '#234567', sidebarWidth: 'compact' });
  assert.equal(prefs.actionColor, '#AABBCC');
  assert.equal(prefs.dataViewSurface, '#234567');
  assert.equal(prefs.sidebarWidth, 'compact');
  assert.equal(buildSemanticTheme(prefs).vars['--card'], '#234567');
  assert.ok(buildSemanticTheme(normalizeUserUiPreferences()).vars['--input-surface']);
});

test('legacy Midnight surfaces upgrade on read while custom actions remain intact', () => {
  const input = { sidebarSurface: '#111827', dataViewSurface: '#F0FBFF', dialogSurface: '#E6F7FF', pageBackgroundStart: '#0B132B', pageBackgroundEnd: '#155E75', borderColor: '#345360', actionColor: '#BBCCDD' };
  const prefs = normalizeUserUiPreferences(input);
  assert.equal(buildSemanticTheme(prefs).dark, true);
  assert.equal(prefs.actionColor, '#BBCCDD');
  assert.equal(input.dataViewSurface, '#F0FBFF');
  assert.deepEqual(normalizeUserUiPreferences(prefs), prefs);
});

test('Midnight custom database accents still change header and interaction surfaces', () => {
  const preset = themePresets.find(p => p.id === 'midnight-signal').values;
  const original = buildSemanticTheme(preset).vars;
  const custom = buildSemanticTheme({ ...preset, dataViewAccent: '#B077A5' }).vars;
  for (const key of ['--data-view-header-cell', '--data-view-row-hover', '--surface-selected']) {
    assert.notEqual(custom[key], original[key]);
    assert.ok(contrastRatio(custom[key], custom['--foreground']) >= 4.5);
  }
});
