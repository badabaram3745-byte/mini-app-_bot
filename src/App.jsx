/* Subject: Proxium secure customer portal. Design plan: an obsidian control room with cyan signal trails, editorial type contrast, and one clear job: let a proxy customer understand usage, wallet, and plans at a glance. Signature: the rotating orbit around the live balance. This is a front-end prototype with demo data only; connect a real backend before handling authentication or payments. */
import "./theme.css";
import "./overrides.css";
import { useState } from "react";
import { Activity, ArrowUpRight, ChevronRight, CircleDollarSign, Gauge, Globe2, LockKeyhole, Menu, Package, PanelTop, Plus, Radio, Server, Settings2, ShieldCheck, ShoppingBag, Sparkles, Wallet, X, Zap } from "lucide-react";

const plans = [
  { name: "NOVA 10", speed: "10 GB", price: "$4.90", accent: "cyan", note: "برای شروع سریع" },
  { name: "ORBIT 50", speed: "50 GB", price: "$14.90", accent: "violet", note: "انتخاب محبوب" },
  { name: "ECLIPSE ∞", speed: "نامحدود", price: "$29.90", accent: "lime", note: "برای استفاده سنگین" },
];
const nav = ["Overview", "My services", "Buy a plan", "Wallet", "Activity"];
const navFa = ["نمای کلی", "سرویس‌های من", "خرید پلن", "کیف پول", "فعالیت‌ها"];

function App() {
  const [active, setActive] = useState("Overview");
  const [lang, setLang] = useState("en");
  const [light, setLight] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [toast, setToast] = useState("");
  const notify = (text) => { setToast(text); setTimeout(() => setToast(""), 2600); };

  const fa = lang === "fa";
  const label = (en, faText) => fa ? faText : en;
  return <div className={`app-shell ${light ? "light" : ""}`} dir={fa ? "rtl" : "ltr"}>
    <div className="grain" />
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Radio size={19}/></span><span>PROXIUM<span className="dot">.</span></span></div>
      <nav className="desktop-nav">{nav.map((item, i) => <button key={item} className={active === item ? "active" : ""} onClick={() => setActive(item)}>{fa ? navFa[i] : item}</button>)}</nav>
      <div className="top-actions"><button className="mode-btn" onClick={() => setLang(fa ? "en" : "fa")}>{fa ? "EN" : "فا"}</button><button className="mode-btn" onClick={() => setLight(!light)}>{light ? "☾" : "☼"}</button><button className="icon-btn" onClick={() => notify(label("Notifications are quiet for now","اعلان جدیدی نیست"))} aria-label="Notifications"><Activity size={18}/></button><button className="profile" onClick={() => setShowLogin(true)}><span className="avatar">KB</span><span className="profile-copy"><b>Koko Baram</b><small>ID 8489061532</small></span><ChevronRight size={16}/></button><button className="icon-btn mobile-menu" onClick={() => setMenu(!menu)} aria-label="Menu">{menu ? <X size={20}/> : <Menu size={20}/>}</button></div>
    </header>
    {menu && <div className="mobile-nav">{nav.map((item, i) => <button key={item} onClick={() => { setActive(item); setMenu(false); }}>{fa ? navFa[i] : item}</button>)}</div>}

    <main className="content">
      <section className="hero-row">
        <div><p className="eyebrow"><span className="live-dot"/> {label("SYSTEM ONLINE","سیستم فعال")} / 01:12 UTC</p><h1>{label("Your network,","شبکه‌ی شما،")}<br/><em>{label("in orbit.","در مدار.")}</em></h1><p className="hero-sub">{label("A private control room for every service, wallet action, and connection in one place.","اتاق کنترل خصوصی برای سرویس‌ها، کیف پول و اتصال‌های شما.")}</p></div>
        <div className="hero-actions"><button className="button primary" onClick={() => setActive("Buy a plan")}><Plus size={18}/> {label("Add service","افزودن سرویس")}</button><button className="button ghost" onClick={() => notify(label("Support channel opening soon","پشتیبانی به‌زودی فعال می‌شود"))}><ShieldCheck size={17}/> {label("Secure support","پشتیبانی امن")}</button></div>
      </section>

      <section className="signal-grid">
        <article className="balance-card card"><div className="orbit orbit-a"/><div className="orbit orbit-b"/><div className="balance-head"><span className="label"><Wallet size={15}/> {label("Available balance","موجودی قابل استفاده")}</span><button className="more" onClick={() => setActive("Wallet")}>•••</button></div><div className="balance-value">$128<span>.40</span></div><div className="balance-foot"><span className="positive">+ $42.00 {label("this month","این ماه")}</span><button className="mini-action" onClick={() => notify(label("Wallet top-up flow is ready for backend connection","شارژ کیف پول آماده اتصال به بک‌اند است"))}>{label("Top up","شارژ کیف پول")} <ArrowUpRight size={14}/></button></div><div className="orbit-core"><CircleDollarSign size={20}/></div></article>
        <article className="metric card"><div className="metric-icon cyan"><Gauge size={20}/></div><div><span className="label">{label("Data consumed","مصرف داده")}</span><strong>18.4 <small>/ 50 GB</small></strong><div className="progress"><i style={{width:"37%"}}/></div><p>{label("37% used · resets in 21 days","۳۷٪ مصرف شده · تمدید تا ۲۱ روز دیگر")}</p></div></article>
        <article className="metric card"><div className="metric-icon violet"><Globe2 size={20}/></div><div><span className="label">{label("Active locations","موقعیت‌های فعال")}</span><strong>03 <small>{label("nodes","نود")}</small></strong><div className="node-row"><span/><span/><span/></div><p>Frankfurt · Helsinki · Tokyo</p></div></article>
      </section>

      <section className="section-head"><div><p className="eyebrow">{label("CURATED FOR YOUR ROUTE","پیشنهاد ویژه برای مسیر شما")}</p><h2>{label("Choose your next","مدار بعدی خود را")} <em>{label("orbit.","انتخاب کنید.")}</em></h2></div><button className="text-button" onClick={() => setActive("Buy a plan")}>{label("View all plans","مشاهده همه پلن‌ها")} <ArrowUpRight size={16}/></button></section>
      <section className="plans">{plans.map((plan, i) => <article className={`plan-card card ${plan.accent}`} key={plan.name}><div className="plan-top"><span className="plan-index">0{i+1}</span><span className="plan-note">{plan.note}</span></div><div className="plan-icon"><Zap size={25}/></div><h3>{plan.name}</h3><p className="plan-speed">{plan.speed} <span>proxy traffic</span></p><div className="plan-bottom"><b>{plan.price}<small>/month</small></b><button className="round-arrow" onClick={() => notify(`${plan.name} selected · connect checkout backend`)}><ArrowUpRight size={18}/></button></div></article>)}</section>

      <section className="lower-grid"><article className="activity-card card"><div className="card-head"><div><p className="eyebrow">LIVE LEDGER</p><h2>Recent activity</h2></div><button className="more" onClick={() => setActive("Activity")}>View all <ArrowUpRight size={15}/></button></div><div className="activity-list"><ActivityRow icon={<ShoppingBag/>} title="ORBIT 50 renewed" detail="Today, 00:48 · Mastercard •••• 0842" amount="+$14.90"/><ActivityRow icon={<Server/>} title="Tokyo node activated" detail="Yesterday, 18:20 · ORBIT 50" amount="LIVE" live/><ActivityRow icon={<CircleDollarSign/>} title="Wallet funded" detail="Oct 09, 14:11 · Manual top up" amount="+$50.00"/></div></article><article className="security-card card"><div className="security-orb"><LockKeyhole size={27}/></div><p className="eyebrow">PRIVATE BY DEFAULT</p><h2>Your access<br/><em>stays yours.</em></h2><p>Use your numeric account ID with a password set inside the bot. No secrets belong in this dashboard prototype.</p><button className="button dark" onClick={() => setShowLogin(true)}>Open secure login <ArrowUpRight size={16}/></button></article></section>
      <footer><span>PROXIUM / CUSTOMER CONTROL ROOM</span><span><Settings2 size={14}/> Backend connection required for live data</span></footer>
    </main>
    {showLogin && <div className="modal-backdrop" onClick={() => setShowLogin(false)}><div className="modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setShowLogin(false)}><X size={19}/></button><div className="modal-icon"><LockKeyhole size={22}/></div><p className="eyebrow">SECURE ACCESS</p><h2>Enter your orbit.</h2><p className="modal-copy">Demo UI only. Connect your own backend session endpoint before production use.</p><label>Numeric account ID<input value="8489061532" readOnly/></label><label>Password<input type="password" placeholder="Your website password"/></label><button className="button primary full" onClick={() => { setShowLogin(false); notify("Demo login accepted") }}>Continue <ArrowUpRight size={16}/></button></div></div>}
    {toast && <div className="toast"><Sparkles size={16}/>{toast}</div>}
  </div>
}
function ActivityRow({icon,title,detail,amount,live}) { return <div className="activity-row"><span className="row-icon">{icon}</span><div><b>{title}</b><small>{detail}</small></div><strong className={live ? "live-text" : ""}>{amount}</strong></div> }
export default App;
