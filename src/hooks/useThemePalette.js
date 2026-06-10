import { useEffect, useMemo } from "react";
import {
  APP_TEXT_DARK,
  APP_TEXT_LIGHT,
  contentDensityStyles,
  getContrastTextColor,
  hexToRgba,
  mixHexColors,
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
    const dialogTone = dialogText === APP_TEXT_LIGHT ? APP_TEXT_LIGHT : APP_TEXT_DARK;
    const sidebarSize = sidebarWidthStyles[themeSettings.sidebarWidth] || sidebarWidthStyles.standard;
    const density = contentDensityStyles[themeSettings.contentDensity] || contentDensityStyles.comfortable;
    const dialogBorder = hexToRgba(dialogTone, dialogText === APP_TEXT_LIGHT ? 0.18 : 0.12);
    const dialogMutedSurface = mixHexColors(
      themeSettings.dialogSurface,
      dialogText === APP_TEXT_LIGHT ? "#FFFFFF" : APP_TEXT_DARK,
      dialogText === APP_TEXT_LIGHT ? 0.08 : 0.04
    );

    return {
      rootStyle: {
        backgroundImage: `linear-gradient(135deg, ${themeSettings.pageBackgroundStart} 0%, ${mixHexColors(themeSettings.pageBackgroundStart, "#FFFFFF", 0.5)} 48%, ${themeSettings.pageBackgroundEnd} 100%)`,
        "--primary": themeSettings.actionColor,
        "--primary-foreground": actionText,
        "--ring": themeSettings.actionColor,
        "--dialog-surface": themeSettings.dialogSurface,
        "--dialog-foreground": dialogText,
        "--dialog-border": dialogBorder,
        "--dialog-muted-surface": dialogMutedSurface,
        "--dialog-footer-surface": dialogMutedSurface,
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
        borderColor: hexToRgba(themeSettings.sidebarHeader, 0.12),
      },
      sidebarHeader: {
        backgroundColor: themeSettings.sidebarHeader,
        color: sidebarHeaderText,
      },
      sidebarHeaderMuted: hexToRgba(sidebarHeaderText, sidebarHeaderText === APP_TEXT_LIGHT ? 0.72 : 0.64),
      sidebarInactiveButton: {
        backgroundColor: hexToRgba(sidebarSurfaceTone, sidebarSurfaceText === APP_TEXT_LIGHT ? 0.08 : 0.04),
        borderColor: hexToRgba(sidebarSurfaceTone, sidebarSurfaceText === APP_TEXT_LIGHT ? 0.12 : 0.08),
        color: sidebarSurfaceText,
      },
      sidebarInactiveIcon: {
        backgroundColor: hexToRgba(sidebarSurfaceTone, sidebarSurfaceText === APP_TEXT_LIGHT ? 0.1 : 0.06),
        color: sidebarSurfaceText,
      },
      sidebarInactiveMuted: hexToRgba(sidebarSurfaceText, sidebarSurfaceText === APP_TEXT_LIGHT ? 0.72 : 0.6),
      sidebarActiveButton: {
        backgroundColor: themeSettings.sidebarActive,
        borderColor: themeSettings.sidebarActive,
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
      sidebarActiveMuted: hexToRgba(sidebarActiveText, 0.76),
      heroCard: {
        backgroundColor: themeSettings.heroSurface,
        color: heroText,
      },
      primaryButton: {
        backgroundColor: themeSettings.actionColor,
        borderColor: themeSettings.actionColor,
        color: actionText,
      },
      primaryButtonHover: mixHexColors(themeSettings.actionColor, "#000000", 0.12),
      dialogSurface: themeSettings.dialogSurface,
      dialogText,
      dialogBorder,
      dialogMutedSurface,
    };
  }, [themeSettings]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const root = document.documentElement;

    root.style.setProperty("--dialog-surface", themePalette.dialogSurface);
    root.style.setProperty("--dialog-foreground", themePalette.dialogText);
    root.style.setProperty("--dialog-border", themePalette.dialogBorder);
    root.style.setProperty("--dialog-muted-surface", themePalette.dialogMutedSurface);
    root.style.setProperty("--dialog-footer-surface", themePalette.dialogMutedSurface);

    return () => {
      root.style.removeProperty("--dialog-surface");
      root.style.removeProperty("--dialog-foreground");
      root.style.removeProperty("--dialog-border");
      root.style.removeProperty("--dialog-muted-surface");
      root.style.removeProperty("--dialog-footer-surface");
    };
  }, [themePalette.dialogBorder, themePalette.dialogMutedSurface, themePalette.dialogSurface, themePalette.dialogText]);

  return {
    themeSettings,
    themePalette,
  };
}
