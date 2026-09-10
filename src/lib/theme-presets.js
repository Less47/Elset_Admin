export const themePresets = [
  {
    id: "elset",
    label: "Elset Classic",
    description: "The original Elset brand palette with the bright blue shell and orange action colour.",
    values: {
      pageBackgroundStart: "#0F90CD",
      pageBackgroundEnd: "#0F90CD",
      sidebarSurface: "#FFFFFF",
      sidebarHeader: "#0F90CD",
      sidebarActive: "#F69320",
      heroSurface: "#0F90CD",
      actionColor: "#F69320",
      borderColor: "#1E293B",
      dialogSurface: "#9FE4FB",
      dataViewSurface: "#EAF7FB",
      dataViewAccent: "#0F90CD",
    },
  },
  {
    id: "copper-dawn",
    label: "Copper Dawn",
    description: "Warm terracotta, soft cream, and punchier copper action colours.",
    values: {
      pageBackgroundStart: "#FFF1E7",
      pageBackgroundEnd: "#F3BA8D",
      sidebarSurface: "#EED7C5",
      sidebarHeader: "#8A3C22",
      sidebarActive: "#F58A4B",
      heroSurface: "#A94A24",
      actionColor: "#E6632B",
      borderColor: "#5A2F20",
      dialogSurface: "#F6E5D7",
      dataViewSurface: "#F1DECD",
      dataViewAccent: "#C96C33",
    },
  },
  {
    id: "evergreen-ledger",
    label: "Evergreen Ledger",
    description: "Deep greens, pale paper surfaces, and a more grounded workshop feel.",
    values: {
      pageBackgroundStart: "#EEF7E8",
      pageBackgroundEnd: "#B4D29B",
      sidebarSurface: "#D3E3CE",
      sidebarHeader: "#22492D",
      sidebarActive: "#6BAE58",
      heroSurface: "#2E603A",
      actionColor: "#80C24D",
      borderColor: "#23422B",
      dialogSurface: "#E5EEDD",
      dataViewSurface: "#DFEADA",
      dataViewAccent: "#5E8F51",
    },
  },
  {
    id: "midnight-signal",
    label: "Midnight Signal",
    description: "True dark mode: layered midnight surfaces, light text, and restrained blue actions.",
    values: {
      pageBackgroundStart: "#080D16",
      pageBackgroundEnd: "#0A101B",
      sidebarSurface: "#111827",
      sidebarHeader: "#132A43",
      sidebarActive: "#1B436F",
      heroSurface: "#111827",
      actionColor: "#1469B8",
      borderColor: "#34465E",
      dialogSurface: "#162235",
      dataViewSurface: "#101826",
      dataViewAccent: "#5F87A5",
    },
  },
  {
    id: "studio-rose",
    label: "Studio Rose",
    description: "Soft blush foundations with richer magenta accents and darker wine framing.",
    values: {
      pageBackgroundStart: "#FFF1F5",
      pageBackgroundEnd: "#F4BCCB",
      sidebarSurface: "#E8CFDA",
      sidebarHeader: "#7A2D4F",
      sidebarActive: "#E36D97",
      heroSurface: "#95395E",
      actionColor: "#D94C7F",
      borderColor: "#61263F",
      dialogSurface: "#F4E2E9",
      dataViewSurface: "#EFDBE3",
      dataViewAccent: "#D94C7F",
    },
  },
  {
    id: "desert-circuit",
    label: "Desert Circuit",
    description: "Sand, brass, and workshop amber for a warmer, more industrial palette.",
    values: {
      pageBackgroundStart: "#FFF6DB",
      pageBackgroundEnd: "#E7C56D",
      sidebarSurface: "#E7D8B7",
      sidebarHeader: "#5A4718",
      sidebarActive: "#C9901E",
      heroSurface: "#7A5C12",
      actionColor: "#DE7E12",
      borderColor: "#4A3915",
      dialogSurface: "#F3E8CF",
      dataViewSurface: "#EEE1C3",
      dataViewAccent: "#D4932A",
    },
  },
];

// Recognise the old Midnight seed combination when reading existing accounts.
// Only unchanged legacy seeds are upgraded; custom actions/layout stay intact.
// No database rewrite or workspace-wide migration is required.
export function upgradeLegacyAppearance(settings) {
  if (settings.sidebarSurface !== '#111827' || settings.dataViewSurface !== '#F0FBFF'
    || settings.dialogSurface !== '#E6F7FF' || settings.pageBackgroundStart !== '#0B132B') return settings;
  return {
    ...settings, dataViewSurface: '#101826', dialogSurface: '#162235', pageBackgroundStart: '#080D16',
    pageBackgroundEnd: settings.pageBackgroundEnd === '#155E75' ? '#0A101B' : settings.pageBackgroundEnd,
    borderColor: settings.borderColor === '#345360' ? '#34465E' : settings.borderColor,
  };
}

