import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  FlatList,
} from 'react-native';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';

const DAYS_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTHS_TR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function toIso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

/** Returns 0 = Mon, 6 = Sun */
function getStartDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

type Props = {
  visible: boolean;
  value?: string; // ISO date only yyyy-MM-dd
  onSelect: (dateIso: string) => void;
  onClose: () => void;
};

export default function DatePickerModal({ visible, value, onSelect, onClose }: Props) {
  const today = new Date();
  const initial = value ? new Date(value + 'T00:00:00') : today;

  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [selected, setSelected] = useState(value ?? toIso(today.getFullYear(), today.getMonth(), today.getDate()));

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const startDay = getStartDayOfMonth(viewYear, viewMonth);

  // Build cells: null = empty leading slot, number = day
  const cells: (number | null)[] = [
    ...Array(startDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  function selectDay(day: number) {
    const iso = toIso(viewYear, viewMonth, day);
    setSelected(iso);
    onSelect(iso);
    onClose();
  }

  function quickSelectToday() {
    const iso = toIso(today.getFullYear(), today.getMonth(), today.getDate());
    setSelected(iso);
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    onSelect(iso);
    onClose();
  }

  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Drag handle */}
          <View style={styles.handle} />

          {/* Sheet Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Tarih Seç</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X color="#fff" size={22} />
            </TouchableOpacity>
          </View>

          {/* Quick buttons */}
          <View style={styles.quickRow}>
            <TouchableOpacity style={styles.quickBtn} onPress={quickSelectToday}>
              <Text style={styles.quickBtnText}>Bugün</Text>
            </TouchableOpacity>
          </View>

          {/* Month / Year navigator */}
          <View style={styles.navRow}>
            <TouchableOpacity onPress={prevMonth} style={styles.navArrow}>
              <ChevronLeft color="#fff" size={20} />
            </TouchableOpacity>
            <Text style={styles.navLabel}>{MONTHS_TR[viewMonth]} {viewYear}</Text>
            <TouchableOpacity onPress={nextMonth} style={styles.navArrow}>
              <ChevronRight color="#fff" size={20} />
            </TouchableOpacity>
          </View>

          {/* Day-of-week header */}
          <View style={styles.weekRow}>
            {DAYS_TR.map(d => (
              <Text key={d} style={styles.weekDay}>{d}</Text>
            ))}
          </View>

          {/* Day grid */}
          <View style={styles.grid}>
            {cells.map((cell, idx) => {
              if (cell === null) return <View key={`e-${idx}`} style={styles.cell} />;
              const iso = toIso(viewYear, viewMonth, cell);
              const isSelected = iso === selected;
              const isToday = iso === todayIso;
              return (
                <TouchableOpacity
                  key={iso}
                  style={[styles.cell, isSelected && styles.cellSelected, isToday && !isSelected && styles.cellToday]}
                  onPress={() => selectDay(cell)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.cellText, isSelected && styles.cellTextSelected, isToday && !isSelected && styles.cellTextToday]}>
                    {cell}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const CELL_SIZE = 44;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 36,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },

  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  quickBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(185,28,28,0.2)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(185,28,28,0.5)',
  },
  quickBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '700' },

  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  navArrow: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
  },
  navLabel: { color: '#fff', fontSize: 17, fontWeight: '800' },

  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 6,
  },
  weekDay: {
    width: CELL_SIZE,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    fontWeight: '700',
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginHorizontal: (((7 * CELL_SIZE) - (7 * CELL_SIZE)) / 14),
  },
  cellSelected: { backgroundColor: '#B91C1C' },
  cellToday: { borderWidth: 1, borderColor: 'rgba(185,28,28,0.6)' },

  cellText: { color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '600' },
  cellTextSelected: { color: '#fff', fontWeight: '800' },
  cellTextToday: { color: '#ef4444', fontWeight: '800' },
});
