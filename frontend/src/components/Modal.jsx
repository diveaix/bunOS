export default function Modal({ id, open, onClose, title, children }) {
  if (!open) return null;

  return (
    <div className="modal-overlay open" id={id}>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <div className="modal-head">
          <h3 id={`${id}-title`}>{title}</h3>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-form">{children}</div>
      </div>
    </div>
  );
}
