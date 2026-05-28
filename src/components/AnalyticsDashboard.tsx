import React from 'react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend 
} from 'recharts';
import { TrendingUp, AlertCircle, Database } from 'lucide-react';

interface AnalyticsDashboardProps {
  auditQueue: any[];
  uploadedFiles: any[];
  currentCaseId: string;
  setAppMode: (mode: 'AUDIT' | 'COMPOSE' | 'VERTICAL' | 'SYNTHESIS' | 'DASHBOARD') => void;
  setActiveQueueId: (id: string | null) => void;
  currentVersion: string;
  parseJsonFromResult: (result?: string) => any;
  getRechartsData: () => any[];
  getPillarPerformanceData: () => any[];
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  auditQueue,
  uploadedFiles,
  currentCaseId,
  setAppMode,
  setActiveQueueId,
  currentVersion,
  parseJsonFromResult,
  getRechartsData,
  getPillarPerformanceData,
}) => {
  const activeAudits = auditQueue.filter(t => t.status === 'done' && t.caseId === currentCaseId);

  return (
    <section className="lg:col-span-12 space-y-12 animate-in fade-in duration-300">
      {/* Header Box */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-[#222] pb-6">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.3em] text-[#C5A059] flex items-center gap-2" id="dashboard-title">
            <TrendingUp size={16} /> (01D) ANALYTICKÝ_FORENZNÍ_DASHBOARD
          </h2>
          <p className="text-[10px] font-mono text-[#555] mt-1 uppercase">Srovnání kvality, integrity a vývoje argumentů spisu v čase</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[9px] font-mono text-emerald-500 bg-emerald-950/15 border border-emerald-900/40 px-2 py-1 uppercase font-black">
            ● AKTIVNÍ LIVE ANALÝZA
          </span>
          <button 
            id="btn-goto-audit"
            onClick={() => {
              setAppMode('AUDIT');
              window.scrollTo({ top: 300, behavior: 'smooth' });
            }}
            className="px-4 py-2 border border-[#C5A059]/40 bg-[#C5A059]/5 text-[#C5A059] hover:bg-[#C5A059] hover:text-black uppercase text-[10px] font-black transition-all"
          >
            Nahrát další a Spustit audit &rarr;
          </button>
        </div>
      </div>

      {/* KPI Summary Widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-[#151515] border border-[#222] p-6 relative overflow-hidden group" id="kpi-total-audits">
          <div className="text-[9px] font-mono font-black text-[#555] uppercase tracking-wider">Celkem provedených auditů</div>
          <div className="text-4xl font-extrabold text-white mt-2 font-serif italic">
            {activeAudits.length || 5}
          </div>
          <div className="text-[9px] font-mono text-[#C5A059] mt-3">
            {activeAudits.length === 0 ? "Exemplární benchmark standard" : "Reálná data aktivního spisu"}
          </div>
          <div className="absolute top-0 right-0 w-1 h-full bg-[#C5A059]/40" />
        </div>

        <div className="bg-[#151515] border border-[#222] p-6 relative overflow-hidden group" id="kpi-avg-integrity">
          <div className="text-[9px] font-mono font-black text-[#555] uppercase tracking-wider">Průměrné skóre integrity</div>
          <div className="text-4xl font-extrabold text-[#C5A059] mt-2 font-serif italic">
            {(() => {
              if (activeAudits.length === 0) return "86%";
              const avg = activeAudits.reduce((acc, t) => acc + (parseJsonFromResult(t.result)?.score || 85), 0) / activeAudits.length;
              return `${Math.round(avg)}%`;
            })()}
          </div>
          <div className="text-[9px] font-mono text-[#666] mt-3">Forenzní NOZ a ZŘS validátor</div>
          <div className="absolute top-0 right-0 w-1 h-full bg-[#C5A059]/40" />
        </div>

        <div className="bg-[#151515] border border-[#222] p-6 relative overflow-hidden group" id="kpi-argument-strength">
          <div className="text-[9px] font-mono font-black text-[#555] uppercase tracking-wider">Úspěšnost / Síla argumentů</div>
          <div className="text-4xl font-extrabold text-emerald-500 mt-2 font-serif italic">
            {(() => {
              if (activeAudits.length === 0) return "79%";
              const avg = activeAudits.reduce((acc, t) => acc + (parseJsonFromResult(t.result)?.metrics?.strength || 75), 0) / activeAudits.length;
              return `${Math.round(avg)}%`;
            })()}
          </div>
          <div className="text-[9px] font-mono text-[#666] mt-3">Průměrný argumentační tlak</div>
          <div className="absolute top-0 right-0 w-1 h-full bg-[#C5A059]/40" />
        </div>

        <div className="bg-[#151515] border border-[#222] p-6 relative overflow-hidden group" id="kpi-total-files">
          <div className="text-[9px] font-mono font-black text-[#555] uppercase tracking-wider">Celkem příloh a spisů</div>
          <div className="text-4xl font-extrabold text-blue-400 mt-2 font-serif italic">
            {uploadedFiles.filter(f => f.caseId === currentCaseId).length}
          </div>
          <div className="text-[9px] font-mono text-[#666] mt-3">Indexované podklady pro verzi</div>
          <div className="absolute top-0 right-0 w-1 h-full bg-[#C5A059]/40" />
        </div>
      </div>

      {/* Warnings and messages for Empty Dashboard state if no audits done yet */}
      {activeAudits.length === 0 && (
        <div className="bg-amber-950/20 border border-amber-900/40 p-6 flex flex-col sm:flex-row items-center justify-between gap-6 rounded-sm" id="empty-state-alert">
          <div className="flex items-center gap-4">
            <AlertCircle size={32} className="text-[#C5A059] shrink-0" />
            <div>
              <h4 className="text-[11px] font-black uppercase text-white tracking-widest">ZOBRAZENY HISTORICKÉ SROVNÁVACÍ STANDARDY</h4>
              <p className="text-[9px] font-mono text-[#888] mt-1 leading-relaxed">
                Spis zatím nemá dokončený žádný forenzní audit ve frontě. Dashboard nyní zobrazuje modelový vývoj kvality typického právního podání. Pro nahrání dat a spuštění prvního reálného auditu přejděte zpět do terminálu.
              </p>
            </div>
          </div>
          <button 
            onClick={() => setAppMode('AUDIT')}
            className="shrink-0 px-4 py-2 border border-[#C5A059]/60 hover:bg-[#C5A059] hover:text-black text-[9px] uppercase font-bold text-[#C5A059] transition-all"
          >
            Spustit první audit
          </button>
        </div>
      )}

      {/* Main Charts block */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Score Trend over time */}
        <div className="bg-[#111] border border-[#222] p-8 space-y-6 rounded-sm transition-all hover:border-[#333]" id="trend-chart-card">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-[#AAA]">Evoluce kvality, síly a pravděpodobnosti úspěchu</h3>
            <p className="text-[9px] font-mono text-[#555] mt-1 leading-normal">Chrono-vývojový trend právních parametrů podle verzí snapshotu spisu.</p>
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={getRechartsData()} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#1c1c1c" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#555" tick={{ fontSize: 9, fontFamily: 'monospace' }} />
                <YAxis domain={[0, 100]} stroke="#555" tick={{ fontSize: 9, fontFamily: 'monospace' }} />
                <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#222', fontSize: '11px', color: '#fff' }} />
                <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                <Line type="monotone" dataKey="Integrita" name="Skóre Integrity (%)" stroke="#C5A059" strokeWidth={2.5} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="Sila" name="Síla argumentů (%)" stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 5" />
                <Line type="monotone" dataKey="Uspesnost" name="Pravděpodobnost úspěchu (%)" stroke="#3b82f6" strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Performance by Pillars */}
        <div className="bg-[#111] border border-[#222] p-8 space-y-6 rounded-sm transition-all hover:border-[#333]" id="pillars-chart-card">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-[#AAA]">Úspěšnost pilířů a shoda se standardy</h3>
            <p className="text-[9px] font-mono text-[#555] mt-1 leading-normal">Průměrné dosažené skóre podání při aktivaci jednotlivých zkoumaných pilířů.</p>
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={getPillarPerformanceData()} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#1c1c1c" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#555" tick={{ fontSize: 8, fontFamily: 'monospace' }} />
                <YAxis domain={[0, 100]} stroke="#555" tick={{ fontSize: 9, fontFamily: 'monospace' }} />
                <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#222', fontSize: '11px', color: '#fff' }} />
                <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                <Bar dataKey="Úspěšnost (%)" fill="#C5A059" opacity={0.8} radius={[2, 2, 0, 0]} />
                <Bar dataKey="Aktivních auditů" name="Aktivní výskyty" fill="#3b82f6" opacity={0.3} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Drafting Activity and Complexity */}
        <div className="bg-[#111] border border-[#222] p-8 space-y-6 xl:col-span-2 rounded-sm transition-all hover:border-[#333]" id="risks-chart-card">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-[#AAA]">Srovnání rizik versus složitost podání</h3>
            <p className="text-[9px] font-mono text-[#555] mt-1 leading-normal">Detekované riziko zásahu protistranou na základě komplexity v čase.</p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={getRechartsData()} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                   <linearGradient id="colorRiziko" x1="0" y1="0" x2="0" y2="1">
                     <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2}/>
                     <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                   </linearGradient>
                </defs>
                <CartesianGrid stroke="#1c1c1c" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#555" tick={{ fontSize: 9, fontFamily: 'monospace' }} />
                <YAxis domain={[0, 100]} stroke="#555" tick={{ fontSize: 9, fontFamily: 'monospace' }} />
                <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#222', fontSize: '11px', color: '#fff' }} />
                <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                <Area type="monotone" dataKey="Riziko" name="Detekované riziko (%)" stroke="#ef4444" fillOpacity={1} fill="url(#colorRiziko)" />
                <Line type="monotone" dataKey="filesCount" name="Počet souborů ve verzi" stroke="#C5A059" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Registry of Provedených Auditů */}
      <div className="bg-[#111] border border-[#222] p-8 space-y-6 rounded-sm animate-in zoom-in duration-200" id="audits-registry-card">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-widest text-[#AAA] flex items-center gap-2">
            <Database size={12} /> REGISTR FORENZNÍCH VYHODNOCENÍ SPISU
          </h3>
          <p className="text-[9px] font-mono text-[#555] mt-1 uppercase">Kompletní protokolární arch v reálném čase</p>
        </div>

        <div className="overflow-x-auto border border-[#222]">
          <table className="w-full text-left border-collapse text-[11px]" id="registry-table">
            <thead>
              <tr className="bg-[#151515] border-b border-[#222] text-[#666] uppercase font-mono text-[9px]">
                <th className="p-4">Časový Snapshot</th>
                <th className="p-4">Identifikovaná Verze</th>
                <th className="p-4 text-center">Integrita</th>
                <th className="p-4">Verdikt (Audit Engine)</th>
                <th className="p-4">Zahrnuté Pilíře</th>
                <th className="p-4 text-right">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#181818] font-mono text-[10px]">
              {activeAudits.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-[#444] italic">
                    Žádné vygenerované protokoly v registru aktivního spisu. Spusťte audit pro zobrazení reálného archu.
                  </td>
                </tr>
              ) : (
                activeAudits.map((task) => {
                  const parsed = parseJsonFromResult(task.result);
                  const formattedDate = new Date(task.timestamp).toLocaleString('cs-CZ');
                  const score = parsed?.score !== undefined ? parsed.score : 85;
                  const verdict = parsed?.verdict || 'REVISE';

                  return (
                    <tr key={task.id} className="hover:bg-white/[0.01] transition-all">
                      <td className="p-4 text-white text-[11px] font-bold">{formattedDate}</td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 bg-[#C5A059]/10 text-[#C5A059] font-black">{task.version || currentVersion}</span>
                      </td>
                      <td className="p-4 text-center text-white font-extrabold text-sm">{score}%</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 font-bold uppercase text-[9px] border ${
                          verdict === 'SUBMIT' 
                            ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/40' 
                            : 'bg-amber-950/20 text-[#C5A059] border-amber-950/40'
                        }`}>
                          {verdict === 'SUBMIT' ? '✓ SUBMIT (Zralé)' : '⚠ REVISE (Upravit)'}
                        </span>
                      </td>
                      <td className="p-4 text-neutral-600 truncate max-w-xs" title={task.pillars.join(', ')}>
                        {task.pillars.join(', ')}
                      </td>
                      <td className="p-4 text-right">
                        <button
                          id={`btn-view-${task.id}`}
                          onClick={() => {
                            setActiveQueueId(task.id);
                            setAppMode('AUDIT');
                            setTimeout(() => {
                              document.getElementById('audit-output')?.scrollIntoView({ behavior: 'smooth' });
                            }, 100);
                          }}
                          className="px-3 py-1 bg-[#1a1a1a] border border-[#333] hover:border-[#C5A059] text-[9px] hover:text-[#C5A059] transition-all uppercase font-bold"
                        >
                          Zobrazit Protokol &rarr;
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
