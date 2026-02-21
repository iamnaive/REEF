type SwarmFinishOverlayProps = {
  open: boolean;
  cleaned: number;
  total: number;
  cashSaved: number;
  bonusText?: string;
  onClose: () => void;
};

export function SwarmFinishOverlay({
  open,
  cleaned,
  total,
  cashSaved,
  bonusText,
  onClose
}: SwarmFinishOverlayProps) {
  if (!open) return null;
  return (
    <div className="swarm-finish-overlay" onClick={onClose}>
      <div className="swarm-finish-center">
        <div className="swarm-trash-bin" />
        <div className="swarm-finish-card">
          <div className="swarm-finish-title">Area Cleaned</div>
          <div className="swarm-finish-row">Cleaned: {cleaned}/{total}</div>
          <div className="swarm-finish-row">Cash saved: +{Math.max(0, Math.round(cashSaved))}</div>
          {bonusText && <div className="swarm-finish-row">{bonusText}</div>}
          <div className="swarm-finish-hint">Tap to close</div>
        </div>
      </div>
    </div>
  );
}
