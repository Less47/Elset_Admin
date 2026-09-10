import { buildSemanticTheme } from "@/lib/theme-tokens";
import { useLayoutEffect, useMemo } from "react";
import {
  APP_TEXT_DARK,
  APP_TEXT_LIGHT,
  contentDensityStyles,
  getContrastTextColor,
  hexToRgba,
  normalizeThemeSettings,
  sidebarWidthStyles,
} from "@/lib/app-support";

export function useThemePalette(settings) {
  const themeSettings = useMemo(() => normalizeThemeSettings(settings), [settings]);

  const themePalette = useMemo(() => {
    const sidebarSurfaceText = getContrastTextColor(themeSettings.sidebarSurface);
    const sidebarSurfaceTone = sidebarSurfaceText === APP_TEXT_LIGHT ? APP_TEXT_LIGHT : APP_TEXT_DARK;
    const sidebarHeaderText = getContrastTextColor(themeSettings.sidebarHeader);
    const heroText = getContrastTextColor(themeSettings.heroSurface);
    const actionText = getContrastTextColor(themeSettings.actionColor);
    const sidebarActiveText = getContrastTextColor(themeSettings.sidebarActive);
    const dialogText = getContrastTextColor(themeSettings.dialogSurface);
    const sidebarSize = sidebarWidthStyles[themeSettings.sidebarWidth] || sidebarWidthStyles.standard;
    const density = contentDensityStyles[themeSettings.contentDensity] || contentDensityStyles.comfortable;
    const borderColor = themeSettings.borderColor;
    const dialogBorder = borderColor;
    const semantic = buildSemanticTheme(themeSettings);
    const dialogSurfaceGradient = semantic.vars['--dialog-surface-gradient'];
    const dialogMutedSurface = semantic.vars['--dialog-muted-surface'];

    return {
      dark: semantic.dark,
      rootStyle: {
        backgroundImage: semantic.vars["--page-gradient"],
        color: semantic.vars["--foreground"],
        colorScheme: semantic.dark ? "dark" : "light",
        ...semantic.vars,
        "--sidebar-width": sidebarSize.width,
        "--sidebar-offset": sidebarSize.offset,
        "--section-gap": density.sectionGap,
        "--content-padding-x-mobile": density.mobileX,
        "--content-padding-y-mobile": density.mobileY,
        "--content-padding-x-sm": density.smX,
        "--content-padding-y-sm": density.smY,
        "--content-padding-x-lg": density.lgX,
        "--content-padding-y-lg": density.lgY,
      },
      sidebarShell: {
        backgroundColor: hexToRgba(themeSettings.sidebarSurface, 0.94),
        borderColor,
      },
      sidebarHeader: {
        backgroundColor: themeSettings.sidebarHeader,
        color: sidebarHeaderText,
      },
      sidebarHeaderMuted: semantic.vars['--sidebar-header-muted'],
      sidebarInactiveButton: {
        backgroundColor: hexToRgba(sidebarSurfaceTone, sidebarSurfaceText === APP_TEXT_LIGHT ? 0.08 : 0.04),
        borderColor,
        color: sidebarSurfaceText,
      },
      sidebarInactiveIcon: {
        backgroundColor: hexToRgba(sidebarSurfaceTone, sidebarSurfaceText === APP_TEXT_LIGHT ? 0.1 : 0.06),
        color: sidebarSurfaceText,
      },
      sidebarInactiveMuted: semantic.vars['--sidebar-muted'],
      sidebarActiveButton: {
        backgroundColor: themeSettings.sidebarActive,
        borderColor,
        color: sidebarActiveText,
        boxShadow: `0 18px 34px -22px ${hexToRgba(themeSettings.sidebarActive, 0.6)}`,
      },
      sidebarActiveIcon: {
        backgroundColor: hexToRgba(
          sidebarActiveText === APP_TEXT_LIGHT ? APP_TEXT_LIGHT : APP_TEXT_DARK,
          sidebarActiveText === APP_TEXT_LIGHT ? 0.12 : 0.08
        ),
        color: sidebarActiveText,
      },
      sidebarActiveMuted: semantic.vars['--sidebar-primary-muted'],
      heroCard: {
        backgroundColor: themeSettings.heroSurface,
        borderColor,
        color: heroText,
      },
      primaryButton: {
        backgroundColor: themeSettings.actionColor,
        borderColor,
        color: actionText,
      },
      primaryButtonHover: semantic.vars["--primary-hover"],
      borderColor,
      dialogSurface: themeSettings.dialogSurface,
      dialogSurfaceGradient,
      dialogText,
      dialogBorder,
      dialogMutedSurface,
    };
  }, [themeSettings]);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;

    const root = document.documentElement;

    const variables = Object.entries(themePalette.rootStyle).filter(([key]) => key.startsWith('--'));
    for (const [key, value] of variables) root.style.setProperty(key, value);
    root.classList.toggle('dark', themePalette.dark);
    root.dataset.themeMode = themePalette.dark ? 'dark' : 'light';
    root.style.colorScheme = themePalette.dark ? 'dark' : 'light';
    return () => {
      for (const [key] of variables) root.style.removeProperty(key);
      root.classList.remove('dark');
      delete root.dataset.themeMode;
      root.style.removeProperty('color-scheme');
    };
  }, [themePalette]);


  return { themeSettings, themePalette };
}
