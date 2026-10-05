import { useRef } from "react";
import { Button } from "@/components/ui/button";

export default function MaintenanceSignature({ onChange, disabled }) {
  const canvas = useRef(null), drawing = useRef(false);
  function position(event) {
    const rect = canvas.current.getBoundingClientRect();
    return [(event.clientX - rect.left) * canvas.current.width / rect.width, (event.clientY - rect.top) * canvas.current.height / rect.height];
  }
  function start(event) {
    if (disabled) return;
    event.preventDefault(); canvas.current.setPointerCapture(event.pointerId); drawing.current = true;
    const context = canvas.current.getContext("2d"), [x, y] = position(event);
    context.strokeStyle = "#111827"; context.lineWidth = 3; context.lineCap = "round";
    context.beginPath(); context.moveTo(x, y); context.lineTo(x + .1, y + .1); context.stroke();
  }
  function finish() {
    if (!drawing.current) return;
    drawing.current = false; onChange(canvas.current.toDataURL("image/png"));
  }
  return <div className="grid gap-2">
    <p id="maintenance-signature-help" className="text-xs text-muted-foreground">Draw with a mouse, stylus or finger. Choose unavailable or declined if a signature cannot be obtained.</p>
    <canvas ref={canvas} width={720} height={240} role="img" aria-label="Customer signature drawing area" aria-describedby="maintenance-signature-help" className="maintenance-signature-canvas"
      onPointerDown={start} onPointerMove={event => { if (!drawing.current) return; const [x, y] = position(event), context = canvas.current.getContext("2d"); context.lineTo(x, y); context.stroke(); }}
      onPointerUp={finish} onPointerCancel={finish} />
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { canvas.current.getContext("2d").clearRect(0, 0, 720, 240); onChange(""); }}>Clear signature</Button>
  </div>;
}
