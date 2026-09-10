// Presentation-only palette. The existing eleven account colour controls are
// the persisted seeds; related surfaces and accessible foregrounds are derived.
export function mixColor(base, other, weight) {
  const channels = (hex) => hex.slice(1).match(/../g).map((part) => parseInt(part, 16));
  const a = channels(base), b = channels(other);
  return '#' + a.map((value, i) => Math.round(value + (b[i] - value) * weight).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

export function contrastRatio(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function contrastText(background, { dark = '#0F172A', light = '#FFFFFF' } = {}) {
  const choice = contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
  return contrastRatio(background, choice) >= 4.5 ? choice : '#000000';
}

function readable(candidate, backgrounds, minimum = 4.5) {
  if (backgrounds.every((bg) => contrastRatio(candidate, bg) >= minimum)) return candidate;
  const target = contrastText(backgrounds[0]);
  for (let step = 1; step <= 20; step++) {
    const value = mixColor(candidate, target, step / 20);
    if (backgrounds.every((bg) => contrastRatio(value, bg) >= minimum)) return value;
  }
  return target;
}

// Explicit preset text palettes, keyed by the persisted surface seed. Custom
// colours use contrast selection; presets never depend on colour inversion.
const textPalettes = {
  '#EAF7FB': ['#142D40', '#354F60', '#4C6575'],
  '#F1DECD': ['#35261F', '#594436', '#6C5343'],
  '#DFEADA': ['#203629', '#3E5141', '#506352'],
  '#101826': ['#F5F7FA', '#CBD5E1', '#A6B5C9'],
  '#EFDBE3': ['#382331', '#5D3E50', '#705365'],
  '#EEE1C3': ['#342B1E', '#574B35', '#695A40'],
};

export function buildSemanticTheme(settings) {
  const surface = settings.dataViewSurface;
  const dark = contrastText(surface) === '#FFFFFF';
  const midnight = surface === '#101826';
  const midnightAccent = midnight && settings.dataViewAccent === '#5F87A5';
  const raised = midnight ? '#162235' : mixColor(surface, '#FFFFFF', dark ? 0.045 : 0.23);
  const muted = midnightAccent ? '#1B293D' : mixColor(surface, settings.dataViewAccent, dark ? 0.15 : 0.13);
  const input = midnight ? '#0C1421' : mixColor(surface, '#FFFFFF', dark ? 0.025 : 0.4);
  const hover = midnightAccent ? '#253851' : mixColor(surface, settings.dataViewAccent, dark ? 0.23 : 0.20);
  const selected = midnightAccent ? '#233D5A' : mixColor(surface, settings.dataViewAccent, 0.25);
  const surfaces = [surface, raised, muted, input, hover, selected];
  const intended = textPalettes[surface] || (dark ? ['#F5F7FA', '#CBD5E1', '#A6B5C9'] : ['#17212D', '#354556', '#506174']);
  const [text, secondary, metadata] = intended.map((value) => readable(value, surfaces));
  const border = settings.borderColor;
  const strong = mixColor(border, text, 0.23);
  const popup = settings.dialogSurface;
  const popupText = contrastText(popup);
  const popupMuted = readable(mixColor(popupText, popup, 0.25), [popup]);
  const actionText = contrastText(settings.actionColor);
  const actionHover = mixColor(settings.actionColor, actionText === '#FFFFFF' ? '#000000' : '#FFFFFF', 0.10);
  const vars = {
    '--background': settings.pageBackgroundStart, '--foreground': text,
    '--card': surface, '--card-foreground': text, '--surface-raised': raised,
    '--muted': muted, '--muted-foreground': metadata, '--text-secondary': secondary,
    '--surface-hover': hover, '--surface-selected': selected, '--input-surface': input,
    '--secondary': raised, '--secondary-foreground': text,
    '--accent': hover, '--accent-foreground': text,
    '--popover': popup, '--popover-foreground': popupText,
    '--border': border, '--border-strong': strong, '--input': strong, '--ui-border-color': border,
    '--primary': settings.actionColor, '--primary-foreground': actionText,
    '--primary-hover': actionHover, '--ring': readable(settings.actionColor, [surface], 3),
    '--link': readable(settings.actionColor, surfaces),
    '--page-gradient': `linear-gradient(135deg, ${settings.pageBackgroundStart}, ${settings.pageBackgroundEnd})`,
    '--workspace-hero-bg': settings.heroSurface, '--workspace-hero-text': contrastText(settings.heroSurface),
    '--workspace-hero-muted': readable(mixColor(contrastText(settings.heroSurface), settings.heroSurface, 0.16), [settings.heroSurface]),
    '--dialog-surface': popup, '--dialog-foreground': popupText, '--dialog-border': border,
    '--dialog-color-scheme': popupText === '#FFFFFF' ? 'dark' : 'light',
    '--dialog-muted-foreground': popupMuted,
    '--dialog-input-surface': mixColor(popup, popupText === '#FFFFFF' ? '#000000' : '#FFFFFF', 0.16),
    '--dialog-muted-surface': mixColor(popup, popupText, 0.06),
    '--dialog-footer-surface': mixColor(popup, popupText, 0.06),
    '--dialog-surface-gradient': `linear-gradient(180deg, ${popup}, ${mixColor(popup, popupText, 0.025)})`,
    '--sidebar': settings.sidebarSurface, '--sidebar-foreground': contrastText(settings.sidebarSurface),
    '--sidebar-header': settings.sidebarHeader, '--sidebar-header-foreground': contrastText(settings.sidebarHeader),
    '--sidebar-header-muted': readable(mixColor(contrastText(settings.sidebarHeader), settings.sidebarHeader, 0.16), [settings.sidebarHeader]),
    '--sidebar-muted': readable(mixColor(contrastText(settings.sidebarSurface), settings.sidebarSurface, 0.20), [settings.sidebarSurface]),
    '--sidebar-primary-muted': readable(mixColor(contrastText(settings.sidebarActive), settings.sidebarActive, 0.15), [settings.sidebarActive]),
    '--sidebar-primary': settings.sidebarActive, '--sidebar-primary-foreground': contrastText(settings.sidebarActive),
    '--sidebar-item': mixColor(settings.sidebarSurface, contrastText(settings.sidebarSurface), 0.04),
    '--sidebar-accent': mixColor(settings.sidebarSurface, contrastText(settings.sidebarSurface), 0.10),
    '--sidebar-accent-foreground': contrastText(settings.sidebarSurface), '--sidebar-border': border,
    '--data-view-accent': settings.dataViewAccent, '--data-view-surface': surface,
    '--data-view-header-start': muted, '--data-view-header-end': raised,
    '--data-view-header-cell': muted, '--data-view-row': surface,
    '--data-view-row-alt': raised, '--data-view-row-hover': hover, '--data-view-stat': raised,
    '--data-view-border': border, '--data-view-border-strong': strong, '--data-view-grid-line': border,
    '--scrim': dark ? '#02060CB8' : '#0F172A66',
  };
  // Business meanings stay stable, with dark tinted surfaces and bright text.
  const statuses = {
    info: ['#DCEFFB', '#174D73', '#244E70', '#ACE0FF', '#4396C3'],
    success: ['#DEEEE2', '#225334', '#244D39', '#A5E8BC', '#509971'],
    warning: ['#F5E8C5', '#684407', '#574427', '#F9D88A', '#AD8847'],
    danger: ['#F7DFE5', '#8A2440', '#572C3C', '#FFBACB', '#B66D83'],
    maintenance: ['#DDEFE9', '#245B50', '#224D47', '#99DFCF', '#509D8D'],
    special: ['#EBDFF5', '#5A3577', '#45345D', '#DFC0FA', '#9877B5'],
  };
  for (const [prefix, isDark, base, backgrounds] of [['', dark, surface, surfaces], ['dialog-', popupText === '#FFFFFF', popup, [popup, vars['--dialog-muted-surface']]]]) {
    for (const [name, [lightBg, lightText, darkBg, darkText, edge]] of Object.entries(statuses)) {
      const bg = isDark ? mixColor(base, darkBg, 0.65) : lightBg;
      vars[`--${prefix}status-${name}-surface`] = bg;
      vars[`--${prefix}status-${name}`] = readable(isDark ? darkText : lightText, [bg, ...backgrounds]);
      vars[`--${prefix}status-${name}-border`] = edge;
      vars[`--${prefix}status-${name}-hover`] = mixColor(bg, isDark ? darkText : lightText, 0.10);
    }
  }
  vars['--destructive'] = vars['--status-danger'];
  return { dark, vars };
}
