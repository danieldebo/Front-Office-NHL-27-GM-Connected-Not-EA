/**
 * Footer — persistent site footer on every page.
 * "Created by DeBo" credit, product tagline, Venmo tip link, and the
 * 💡 Feature request button that opens FeatureRequestModal.
 */
import { useState } from 'react';
import FeatureRequestModal from './FeatureRequestModal';

export default function Footer() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <footer className="site-footer">
        <div className="wrap site-footer-inner" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', fontFamily: 'var(--data)', fontSize: '12px', color: '#9FB1BF' }}>
          <span className="made" style={{ color: '#E8EEF3' }}>
            Created by <b style={{ color: 'var(--bulb)', fontFamily: 'var(--body)', fontWeight: 700 }}>DeBo</b>
          </span>
          <span style={{ color: '#5C6B78' }}>·</span>
          <span>Front Office · connected-franchise league tools</span>
          <button
            className="fr-btn"
            onClick={() => setModalOpen(true)}
            type="button"
            aria-haspopup="dialog"
          >
            💡 Feature request
          </button>
          <div
            className="tip"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'var(--slab-2)', border: '1px solid rgba(242,169,59,.25)', borderRadius: '3px', padding: '7px 12px' }}
          >
            <span
              className="amt"
              style={{ fontFamily: 'var(--display)', color: 'var(--bulb)', fontSize: '16px' }}
            >
              $1
            </span>
            <span style={{ color: '#B7C4CE' }}>saved you a spreadsheet? tip the builder →</span>
            <a
              href="https://venmo.com/theedebo"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--bulb)', textDecoration: 'none', fontWeight: 600 }}
            >
              Venmo @theedebo
            </a>
          </div>
        </div>
      </footer>

      {modalOpen && <FeatureRequestModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
