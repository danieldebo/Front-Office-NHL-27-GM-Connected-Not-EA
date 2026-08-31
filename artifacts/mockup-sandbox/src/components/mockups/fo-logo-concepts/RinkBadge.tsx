export function RinkBadge() {
  return (
    <main className="rink-badge">
      <style>{`
        .rink-badge {
          --ink: #101417;
          --navy: #16242d;
          --red: #d22f3b;
          --red-dark: #9e2230;
          --ice: #f1f4f2;
          --chalk: #fffdf8;
          min-height: 100dvh;
          width: 100%;
          display: grid;
          place-items: center;
          overflow: hidden;
          color: var(--ink);
          background:
            linear-gradient(115deg, rgba(255,255,255,.1) 0 1px, transparent 1px 22px),
            var(--ice);
          font-family: "Arial Narrow", "Trebuchet MS", sans-serif;
        }
        .rink-badge__stage {
          width: min(100%, 980px);
          min-height: 100dvh;
          display: grid;
          grid-template-columns: minmax(260px, 1fr) minmax(210px, .72fr);
          align-items: center;
          gap: clamp(18px, 5vw, 74px);
          padding: clamp(28px, 6vw, 74px);
          position: relative;
        }
        .rink-badge__stage::before {
          content: "";
          position: absolute;
          width: 220px;
          height: 220px;
          right: -72px;
          top: 7%;
          border: 1px solid rgba(210,47,59,.23);
          border-radius: 50%;
          box-shadow: 0 0 0 18px rgba(210,47,59,.05), 0 0 0 37px rgba(210,47,59,.04);
        }
        .rink-badge__copy {
          position: relative;
          z-index: 1;
          max-width: 310px;
          animation: rise .7s ease-out both;
        }
        .rink-badge__eyebrow {
          display: flex;
          align-items: center;
          gap: 11px;
          color: var(--red-dark);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .24em;
          text-transform: uppercase;
        }
        .rink-badge__eyebrow::before {
          content: "";
          width: 28px;
          height: 3px;
          background: var(--red);
        }
        .rink-badge h1 {
          margin: 18px 0 14px;
          color: var(--navy);
          font-size: clamp(40px, 6vw, 68px);
          line-height: .88;
          letter-spacing: -.065em;
          text-transform: uppercase;
          font-weight: 900;
        }
        .rink-badge h1 span { color: var(--red); }
        .rink-badge__copy p {
          margin: 0;
          color: #526067;
          font-size: 14px;
          line-height: 1.55;
          max-width: 260px;
        }
        .rink-badge__spec {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 29px;
          padding-top: 16px;
          border-top: 1px solid rgba(16,20,23,.16);
        }
        .rink-badge__spec b {
          display: block;
          color: var(--navy);
          font-size: 11px;
          letter-spacing: .12em;
          text-transform: uppercase;
        }
        .rink-badge__spec small {
          display: block;
          margin-top: 5px;
          color: #68757a;
          font: 10px/1.3 "Courier New", monospace;
          letter-spacing: .03em;
        }
        .rink-badge__art {
          width: min(100%, 470px);
          justify-self: center;
          filter: drop-shadow(0 20px 18px rgba(16,20,23,.16));
          animation: settle .85s cubic-bezier(.2,.75,.25,1) both;
        }
        .rink-badge__art svg {
          display: block;
          width: 100%;
          height: auto;
        }
        .rink-badge__lockup {
          position: absolute;
          right: clamp(28px, 6vw, 74px);
          bottom: clamp(24px, 5vw, 58px);
          display: flex;
          align-items: center;
          gap: 12px;
          color: #667278;
          font: 10px "Courier New", monospace;
          letter-spacing: .16em;
          text-transform: uppercase;
        }
        .rink-badge__lockup::before, .rink-badge__lockup::after {
          content: "";
          display: block;
          width: 17px;
          height: 1px;
          background: var(--red);
        }
        @keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes settle { from { opacity: 0; transform: translateY(20px) rotate(2deg); } to { opacity: 1; transform: translateY(0) rotate(0); } }
        @media (max-width: 680px) {
          .rink-badge__stage {
            grid-template-columns: 1fr;
            min-height: auto;
            padding: 36px 24px 72px;
          }
          .rink-badge__copy { max-width: 420px; }
          .rink-badge__art { width: min(88vw, 390px); margin-top: 4px; }
          .rink-badge__lockup { right: 24px; bottom: 25px; }
          .rink-badge__stage::before { right: -122px; top: 34%; }
        }
      `}</style>

      <section className="rink-badge__stage" aria-label="Front Office Rink Badge logo concept">
        <div className="rink-badge__copy">
          <div className="rink-badge__eyebrow">FO / identity study</div>
          <h1>Rink<br /><span>Badge</span></h1>
          <p>A compact crest for the league office — built from the tools, marks, and hard edges of the game.</p>
          <div className="rink-badge__spec">
            <div><b>Construction</b><small>stick-built F / puck O</small></div>
            <div><b>Application</b><small>patch / avatar / print</small></div>
          </div>
        </div>

        <div className="rink-badge__art">
          <svg viewBox="0 0 560 650" role="img" aria-labelledby="badge-title badge-desc">
            <title id="badge-title">Front Office FO hockey rink badge</title>
            <desc id="badge-desc">A red, white, and charcoal shield containing an F assembled from overlapping taped hockey sticks and an O rendered as a thick black hockey puck.</desc>
            <defs>
              <clipPath id="shieldClip"><path d="M90 42h380v285c0 140-79 232-190 280C169 559 90 467 90 327V42Z" /></clipPath>
              <linearGradient id="redFace" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#e7434d" />
                <stop offset="1" stopColor="#b32231" />
              </linearGradient>
              <linearGradient id="stickShaft" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#fffdf8" />
                <stop offset=".45" stopColor="#e7e8e3" />
                <stop offset=".68" stopColor="#fffdf8" />
                <stop offset="1" stopColor="#bfc7c4" />
              </linearGradient>
              <linearGradient id="puckSide" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#333a3c" />
                <stop offset=".32" stopColor="#0b0e10" />
                <stop offset="1" stopColor="#050607" />
              </linearGradient>
              <radialGradient id="puckFace" cx=".32" cy=".22" r=".86">
                <stop offset="0" stopColor="#4b5556" />
                <stop offset=".22" stopColor="#20282a" />
                <stop offset=".7" stopColor="#0c1011" />
                <stop offset="1" stopColor="#050607" />
              </radialGradient>
            </defs>
            <path d="M90 42h380v285c0 140-79 232-190 280C169 559 90 467 90 327V42Z" fill="#101417" />
            <path d="M108 61h344v265c0 125-68 205-172 254-104-49-172-129-172-254V61Z" fill="url(#redFace)" stroke="#fffdf8" strokeWidth="5" />
            <g clipPath="url(#shieldClip)" opacity=".3" fill="none" stroke="#fffdf8">
              <path d="M-20 194h600M-20 456h600" strokeWidth="8" />
              <path d="M280 18v610M75 325h410" strokeWidth="2" />
              <circle cx="280" cy="325" r="63" strokeWidth="3" />
              <path d="M107 164h346M107 486h346" strokeWidth="2" />
            </g>
            <path d="M129 92h302" stroke="#fffdf8" strokeWidth="4" />
            <text x="280" y="123" textAnchor="middle" fill="#fffdf8" fontSize="20" fontWeight="900" letterSpacing="7" fontFamily="Arial Narrow, sans-serif">FRONT OFFICE</text>
            <path d="M172 146h216" stroke="#101417" strokeWidth="3" />

             {/* F: exactly two complete hockey sticks, overlapped as the upright and crossbar. */}
             <g stroke="#101417" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round">
               {/* Stick one: taped knob, continuous shaft, heel transition, and curved blade. */}
               <path d="M185 185l18-5 15 8-5 190-10 43-18-5 8-43Z" fill="url(#stickShaft)" />
               <path d="M185 185l18-5 15 8-1 32-28 6Z" fill="#101417" />
               <path d="M186 190l29 12M185 201l29 12M185 212l28 12" stroke="#d22f3b" strokeWidth="4" />
               <path d="M203 377l-10 42-11 25 20 7 20-38 5-36Z" fill="url(#stickShaft)" />
               <path d="M202 444c-6 8-12 12-22 11l-39-10-10-11 7-10 45 9Z" fill="url(#stickShaft)" />
               <path d="M141 425l42 9M137 435l40 10" stroke="#d22f3b" strokeWidth="3" />
               {/* Stick two: a single crossbar stick with its own grip, heel, and hooked toe. */}
               <path d="M198 247l113-4 18 12-6 23-122 4Z" fill="url(#stickShaft)" />
               <path d="M198 247l36-2 1 33-36 2Z" fill="#101417" />
               <path d="M200 250l31 11M199 261l32 11M199 272l32 10" stroke="#d22f3b" strokeWidth="4" />
               <path d="M323 255l17 8 12 13-15 18-19-13 6-12Z" fill="url(#stickShaft)" />
               <path d="M337 282l17-7 30 4 9 11-7 13-36-1-15-9Z" fill="#fffdf8" />
               <path d="M348 284l34 4M344 293l35 4" stroke="#d22f3b" strokeWidth="3" />
             </g>
             <path d="M207 229l-5 145M214 229l-5 142M239 260l80-3" stroke="#d22f3b" strokeWidth="2.5" opacity=".85" />
             {/* O: a physical hockey puck — rubber sidewall, bevel, face disc, wear, red mark, and grounding shadow. */}
             <g>
               <ellipse cx="382" cy="326" rx="82" ry="19" fill="#090b0c" opacity=".72" />
               <path d="M299 276v43c0 17 37 31 83 31s83-14 83-31v-43Z" fill="url(#puckSide)" stroke="#101417" strokeWidth="5" />
               <path d="M303 292c11 13 41 22 79 22s68-9 79-22v26c0 15-35 28-79 28s-79-13-79-28Z" fill="#07090a" opacity=".82" />
               <ellipse cx="382" cy="274" rx="83" ry="57" fill="#080b0c" stroke="#555f5f" strokeWidth="4" />
               <ellipse cx="382" cy="270" rx="76" ry="51" fill="url(#puckFace)" stroke="#fffdf8" strokeWidth="6" />
               <ellipse cx="382" cy="270" rx="66" ry="43" fill="none" stroke="#30393a" strokeWidth="3" />
               <ellipse cx="382" cy="270" rx="58" ry="36" fill="none" stroke="#151b1c" strokeWidth="2" opacity=".8" />
               <path d="M329 259c14-21 35-30 59-30 23 0 42 8 54 22" fill="none" stroke="#fffdf8" strokeWidth="5" opacity=".52" strokeLinecap="round" />
               <path d="M327 283c18 18 70 25 109 2" fill="none" stroke="#050607" strokeWidth="5" opacity=".9" />
               <path d="M340 276c19 11 57 15 86 5" fill="none" stroke="#c0c7c4" strokeWidth="2" opacity=".32" />
               <g fill="none" stroke="#7d8785" strokeWidth="1.5" opacity=".38">
                 <circle cx="354" cy="263" r="7" /><circle cx="413" cy="280" r="5" />
                 <circle cx="397" cy="247" r="4" /><circle cx="369" cy="290" r="4" />
               </g>
               <circle cx="355" cy="255" r="4" fill="#e8ece8" opacity=".72" />
               <path d="M314 302c16 12 40 18 68 19 29 0 55-7 70-19" fill="none" stroke="#d22f3b" strokeWidth="4" opacity=".9" />
             </g>
            <path d="M150 412h260" stroke="#fffdf8" strokeWidth="5" />
            <circle cx="280" cy="424" r="10" fill="#101417" stroke="#fffdf8" strokeWidth="3" />
            <path d="M142 470h276" stroke="#101417" strokeWidth="4" />
            <text x="280" y="507" textAnchor="middle" fill="#101417" fontSize="14" fontWeight="900" letterSpacing="5" fontFamily="Courier New, monospace">LEAGUE OFFICE</text>
            <path d="M128 536h304" stroke="#fffdf8" strokeWidth="4" />
            <path d="M90 327H55M470 327h35" stroke="#101417" strokeWidth="8" />
          </svg>
        </div>

        <div className="rink-badge__lockup">FO / rink badge / 01</div>
      </section>
    </main>
  );
}