export default function Sidebar() {
  return (
    <aside>
      {/* CAP */}
      <section className="panel">
        <div className="panel-head"><h2>Your cap</h2><span className="note">Legal</span></div>
        <div className="cap-row"><span>Cap hit</span><span className="v">$81.4M</span></div>
        <div className="cap-row"><span>Space</span><span className="v" style={{ color: '#1F7A4C' }}>$7.1M</span></div>
        <div className="cap-row"><span>Roster</span><span className="v">22 / 23</span></div>
        <div className="cap-row" style={{ borderBottom: 0 }}><span>Expiring</span><span className="v">4</span></div>
        <div className="bar"><i style={{ width: '92%' }}></i></div>
      </section>

      {/* WIRE */}
      <section className="panel" id="wire">
        <div className="panel-head"><h2>Wire</h2><span className="note">Append-only</span></div>

        <div className="wire-item anim" style={{ animationDelay: '.04s' }}>
          <div className="wire-head"><span className="wire-type">Trade</span><span className="wire-time">2h ago</span></div>
          <div className="wire-body"><b>DAL</b> receives a 2027 2nd. <b>COL</b> receives K. Marchment.</div>
          <div className="wire-foot">Approved 6–1 by committee · executed</div>
        </div>

        <div className="wire-item anim" style={{ animationDelay: '.07s' }}>
          <div className="wire-head"><span className="wire-type reversal">Reversal</span><span className="wire-time">Yesterday</span></div>
          <div className="wire-body">Reverses trade #0184. <b>MIN</b> was over the cap at execution.</div>
          <div className="wire-foot">Filed by commissioner · original entry retained</div>
        </div>

        <div className="wire-item anim" style={{ animationDelay: '.1s' }}>
          <div className="wire-head"><span className="wire-type signing">Signing</span><span className="wire-time">Yesterday</span></div>
          <div className="wire-body"><b>CHI</b> signs J. Nazar · $2.4M × 3 yrs</div>
          <div className="wire-foot">Cap checked at signing · legal</div>
        </div>

        <div className="wire-item anim" style={{ animationDelay: '.13s' }}>
          <div className="wire-head"><span className="wire-type waiver">Waivers</span><span className="wire-time">2d ago</span></div>
          <div className="wire-body"><b>NSH</b> places two forwards on waivers.</div>
          <div className="wire-foot">Clears in 22h</div>
        </div>
      </section>

      {/* SEATS */}
      <section className="panel">
        <div className="panel-head"><h2>Open seats</h2><span className="note">3 available</span></div>
        <div className="matchup">
          <span className="mu-teams">NSH</span>
          <span className="mu-when">Vacated Tue · 3 applicants</span>
          <button className="btn ghost">Review</button>
        </div>
        <div className="matchup">
          <span className="mu-teams">SJS</span>
          <span className="mu-when">Never filled · listed publicly</span>
          <button className="btn ghost">Review</button>
        </div>
        <div className="matchup">
          <span className="mu-teams">ANA</span>
          <span className="mu-when">Inactive 14d · auto-flagged</span>
          <button className="btn ghost">Review</button>
        </div>
      </section>
    </aside>
  );
}
