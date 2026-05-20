interface BannerProps {
  kind: "auth" | "sync";
  onAction?: () => void;
}

export function Banner({ kind, onAction }: BannerProps) {
  if (kind === "auth") {
    return (
      <div className="banner auth">
        <span>Session expired — reconnect Drive</span>
        <button onClick={onAction}>Reconnect</button>
      </div>
    );
  }
  return (
    <div className="banner">
      <span>Drive sync paused — retrying…</span>
    </div>
  );
}
