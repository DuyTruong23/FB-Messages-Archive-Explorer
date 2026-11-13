import { useMemo, useState } from 'react';
import type { SearchFilter } from '../../types/overlay';
import { useThreadData } from '../../hooks/useThreadData';
import { getMessageTimestamp, getParticipantNames } from '../../services/parser';
import {
  DEFAULT_SEARCH_FILTER, getMonthRange, getPresetRange, getYearRange, type DatePreset,
} from '../../services/searchFilters';

interface SearchFilterPanelProps {
  filter: SearchFilter;
  onChange: (filter: SearchFilter) => void;
  /** "All chats" mode applies only the normalize toggle. */
  wide: boolean;
  /** Favorites exist only for chats with an overlay. */
  favoritesAvailable: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');

function toInputValue(timestamp: number | null): string {
  if (timestamp === null) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromInputValue(value: string, endOfMinute: boolean): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  // The picker has minute precision; "to" includes the whole selected minute.
  return endOfMinute ? time + 59_999 : time;
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
];

export function SearchFilterPanel({ filter, onChange, wide, favoritesAvailable }: SearchFilterPanelProps) {
  const chatData = useThreadData();
  const participants = useMemo(() => {
    const names = new Set(getParticipantNames(chatData));
    // Former members can appear only as senders.
    for (const message of chatData?.messages ?? []) {
      const sender = message.senderName || message.sender_name;
      if (sender) names.add(sender);
      if (names.size > 200) break;
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [chatData]);
  const years = useMemo(() => {
    const messages = chatData?.messages ?? [];
    let first: number | null = null;
    let last: number | null = null;
    for (const message of messages) {
      const timestamp = getMessageTimestamp(message);
      if (timestamp === null) continue;
      if (first === null || timestamp < first) first = timestamp;
      if (last === null || timestamp > last) last = timestamp;
    }
    if (first === null || last === null) return [];
    const result: number[] = [];
    for (let year = new Date(last).getFullYear(); year >= new Date(first).getFullYear(); year--) result.push(year);
    return result;
  }, [chatData]);
  const [periodYear, setPeriodYear] = useState<number | ''>('');
  const [periodMonth, setPeriodMonth] = useState<number | ''>('');

  const update = (changes: Partial<SearchFilter>) => onChange({ ...filter, ...changes });
  const applyPeriod = (year: number | '', month: number | '') => {
    setPeriodYear(year);
    setPeriodMonth(month);
    if (year === '') return;
    update(month === '' ? getYearRange(year) : getMonthRange(year, month));
  };
  const toggleSender = (name: string) => update({
    senders: filter.senders.includes(name) ? filter.senders.filter(sender => sender !== name) : [...filter.senders, name],
  });

  return (
    <div className="search-filter-panel" role="group" aria-label="Bộ lọc tìm kiếm">
      <label className="search-filter-checks">
        <input type="checkbox" checked={filter.normalize} onChange={event => update({ normalize: event.target.checked })} />
        Bỏ dấu khi tìm (“loi” khớp “lỗi”)
      </label>

      {wide ? (
        <small className="overlay-item-meta">Chế độ “All” chỉ áp dụng tùy chọn bỏ dấu. Chuyển về “Chat” để lọc thêm.</small>
      ) : (
        <>
          {participants.length > 0 && (
            <fieldset>
              <legend>Người gửi</legend>
              <div className="search-filter-chips">
                {participants.map(name => (
                  <button
                    key={name}
                    type="button"
                    className="search-filter-chip"
                    aria-pressed={filter.senders.includes(name)}
                    onClick={() => toggleSender(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend>Thời gian</legend>
            <div className="search-filter-chips">
              {PRESETS.map(preset => (
                <button
                  key={preset.key}
                  type="button"
                  className="search-filter-chip"
                  onClick={() => { setPeriodYear(''); setPeriodMonth(''); update(getPresetRange(preset.key)); }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {years.length > 0 && (
              <div className="search-filter-month">
                <select aria-label="Năm" value={periodYear} onChange={event => applyPeriod(event.target.value ? Number(event.target.value) : '', periodMonth)}>
                  <option value="">Năm…</option>
                  {years.map(year => <option key={year} value={year}>{year}</option>)}
                </select>
                <select aria-label="Tháng" value={periodMonth} disabled={periodYear === ''} onChange={event => applyPeriod(periodYear, event.target.value ? Number(event.target.value) : '')}>
                  <option value="">Cả năm</option>
                  {Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>Tháng {index + 1}</option>)}
                </select>
              </div>
            )}
            <div className="search-filter-dates" style={{ marginTop: 6 }}>
              <label htmlFor="searchFilterFrom">Từ</label>
              <input
                id="searchFilterFrom"
                type="datetime-local"
                value={toInputValue(filter.from)}
                onChange={event => update({ from: fromInputValue(event.target.value, false) })}
              />
              <label htmlFor="searchFilterTo">Đến</label>
              <input
                id="searchFilterTo"
                type="datetime-local"
                value={toInputValue(filter.to === null ? null : filter.to - 59_999)}
                onChange={event => update({ to: fromInputValue(event.target.value, true) })}
              />
            </div>
          </fieldset>

          <fieldset>
            <legend>Chỉ hiện</legend>
            <div className="search-filter-checks">
              <label><input type="checkbox" checked={filter.hasMedia} onChange={event => update({ hasMedia: event.target.checked })} />Có media</label>
              <label><input type="checkbox" checked={filter.hasLink} onChange={event => update({ hasLink: event.target.checked })} />Có link</label>
              {favoritesAvailable && (
                <label><input type="checkbox" checked={filter.favoritesOnly} onChange={event => update({ favoritesOnly: event.target.checked })} />Favorite</label>
              )}
            </div>
          </fieldset>
        </>
      )}

      <div className="search-filter-footer">
        <button
          type="button"
          className="overlay-small-btn"
          onClick={() => { setPeriodYear(''); setPeriodMonth(''); onChange({ ...DEFAULT_SEARCH_FILTER, normalize: filter.normalize }); }}
        >
          Xóa bộ lọc
        </button>
      </div>
    </div>
  );
}
