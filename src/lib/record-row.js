export function recordRowOpenProps(label, onOpen) {
  return {
    role: "group",
    tabIndex: 0,
    "aria-label": label,
    title: "Double-click or press Enter to open",
    onDoubleClick(event) {
      const control = event.target.closest("button, a, input, select, textarea, [role='button'], [role='link'], [contenteditable='true']");
      if (!control || control === event.currentTarget) onOpen();
    },
    onKeyDown(event) {
      if (event.target !== event.currentTarget || event.repeat || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      onOpen();
    },
  };
}
