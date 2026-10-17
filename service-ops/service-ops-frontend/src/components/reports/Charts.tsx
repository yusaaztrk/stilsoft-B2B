import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

/**
 * Rapor grafiklerinin ortak paleti. Tek yerde durması, aynı serinin (ör. "iptal") her ekranda
 * aynı renkte çıkmasını sağlıyor — renk ekrandan ekrana değişirse okuyan kişi her seferinde
 * lejandı yeniden öğrenmek zorunda kalır.
 */
export const SERIES_COLORS = {
  total: '#0f172a',
  completed: '#059669',
  cancelled: '#e11d48',
  pending: '#f59e0b',
  inProgress: '#2563eb',
  installations: '#7c3aed'
} as const

export const CATEGORICAL = ['#0f172a', '#2563eb', '#059669', '#f59e0b', '#e11d48', '#7c3aed', '#0891b2', '#c2410c']

const axisProps = {
  tick: { fontSize: 11, fill: '#64748b' },
  tickLine: false,
  axisLine: { stroke: '#e2e8f0' }
} as const

function ChartFrame({ title, subtitle, height = 260, children }: {
  title: string
  subtitle?: string
  height?: number
  children: React.ReactElement
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs">
      <div className="mb-2">
        <div className="text-xs font-black text-gray-800">{title}</div>
        {subtitle && <div className="text-[10px] text-gray-400 mt-0.5">{subtitle}</div>}
      </div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  )
}

export function TrendAreaChart({ title, subtitle, data, series, height }: {
  title: string
  subtitle?: string
  data: any[]
  series: Array<{ key: string; name: string; color: string }>
  height?: number
}) {
  return (
    <ChartFrame title={title} subtitle={subtitle} height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} width={44} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            fill={`url(#grad-${s.key})`}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  )
}

/**
 * Sıralama grafiği — Top-N için pasta değil yatay bar.
 * On bayiyi pastaya bölmek, dilimleri birbiriyle kıyaslanamaz hale getirir.
 */
export function RankingChart({ title, subtitle, data, nameKey, valueKey, valueName, onSelect, height }: {
  title: string
  subtitle?: string
  data: any[]
  nameKey: string
  valueKey: string
  valueName: string
  onSelect?: (row: any) => void
  height?: number
}) {
  return (
    <ChartFrame title={title} subtitle={subtitle} height={height ?? Math.max(220, data.length * 28 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis type="number" {...axisProps} allowDecimals={false} />
        <YAxis type="category" dataKey={nameKey} {...axisProps} width={140} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f8fafc' }} />
        <Bar
          dataKey={valueKey}
          name={valueName}
          radius={[0, 6, 6, 0]}
          onClick={onSelect ? (payload: any) => onSelect(payload?.payload ?? payload) : undefined}
          cursor={onSelect ? 'pointer' : undefined}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  )
}

export function StackedBarChart({ title, subtitle, data, nameKey, series, height }: {
  title: string
  subtitle?: string
  data: any[]
  nameKey: string
  series: Array<{ key: string; name: string; color: string }>
  height?: number
}) {
  return (
    <ChartFrame title={title} subtitle={subtitle} height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey={nameKey} {...axisProps} />
        <YAxis {...axisProps} width={44} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f8fafc' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ChartFrame>
  )
}

/** Donut yalnızca az sayıda dilim ve anlamlı bir bütün olduğunda kullanılır (ör. 4 iş tipi). */
export function DonutChart({ title, subtitle, data, nameKey, valueKey, onSelect, height }: {
  title: string
  subtitle?: string
  data: any[]
  nameKey: string
  valueKey: string
  onSelect?: (row: any) => void
  height?: number
}) {
  return (
    <ChartFrame title={title} subtitle={subtitle} height={height ?? 260}>
      <PieChart>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius="52%"
          outerRadius="78%"
          paddingAngle={2}
          onClick={onSelect ? (payload: any) => onSelect(payload?.payload ?? payload) : undefined}
          cursor={onSelect ? 'pointer' : undefined}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />
          ))}
        </Pie>
      </PieChart>
    </ChartFrame>
  )
}

const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  fontSize: 11,
  boxShadow: '0 4px 16px rgba(15,23,42,0.08)'
} as const

export function EmptyChart({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-6 text-center">
      <div className="text-xs font-black text-gray-700">{title}</div>
      {/* Veri toplanmayan bir metrik için boş grafik çizmek yerine sebebi yazılıyor. */}
      <div className="text-[11px] text-gray-400 mt-1.5">{reason}</div>
    </div>
  )
}
