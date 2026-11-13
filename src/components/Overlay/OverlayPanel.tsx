import { useEffect, useMemo, useState } from 'react';
import { Download, FileDown, MessageSquare, RotateCcw, Save, Star, Trash2, X } from 'lucide-react';
import type { ChatListEntry, MessengerMessage, MessengerThread } from '../../types/messenger';
import type { OverlayFavorite } from '../../types/overlay';
import type { OverlayController } from '../../hooks/useOverlay';
import { getMessageTimestamp } from '../../services/parser';
import { formatChatTimestamp } from '../../services/dateTime';
import { describeMessage } from '../../services/messageSummary';

export type OverlayPanelMode = 'favorites' | 'deleted';

const PAGE_SIZE = 200;

interface OverlayPanelProps {
  mode: OverlayPanelMode;
  chatData: MessengerThread;
  overlay: OverlayController;
  onClose: () => void;
  onJumpToMessage: (index: number) => void;
  onRequestWriteAccess?: () => Promise<boolean>;
  onFavoritesFileSaved?: (fileName: string) => Promise<ChatListEntry | null>;
  onOpenChat?: (entry: ChatListEntry) => void;
}

function MessageMeta({ msg }: { msg: MessengerMessage }) {
  const timestamp = getMessageTimestamp(msg);
  return (
    <span className="overlay-item-meta">
      {msg.senderName || msg.sender_name || 'Unknown'}{timestamp ? ` · ${formatChatTimestamp(timestamp)}` : ''}
    </span>
  );
}

function FavoriteNote({ favorite, onSave }: { favorite: OverlayFavorite; onSave: (note: string) => void }) {
  const [draft, setDraft] = useState(favorite.note);
  useEffect(() => setDraft(favorite.note), [favorite.note]);
  // Save on blur or Enter: each change re-renders visible bubbles.
  const commit = () => { if (draft !== favorite.note) onSave(draft); };
  return (
    <input
      type="text"
      value={draft}
      placeholder="Ghi chú (tùy chọn)"
      aria-label="Ghi chú favorite"
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}
    />
  );
}

function PersistenceStatus({ overlay, onRequestWriteAccess }: Pick<OverlayPanelProps, 'overlay' | 'onRequestWriteAccess'>) {
  const [requesting, setRequesting] = useState(false);
  const label = overlay.persistence === 'file'
    ? 'Lưu vào file .overlay.json cạnh file gốc.'
    : overlay.persistence === 'indexeddb'
      ? 'Thư mục chỉ đọc: thay đổi lưu trong trình duyệt (IndexedDB).'
      : 'Không lưu được: hãy Export overlay để giữ thay đổi.';
  return (
    <div className="overlay-panel-status" role="status">
      {overlay.saving ? 'Đang lưu… ' : ''}{label}
      {overlay.persistence !== 'file' && onRequestWriteAccess && (
        <button
          type="button"
          className="overlay-small-btn"
          disabled={requesting}
          onClick={async () => {
            setRequesting(true);
            try {
              if (await onRequestWriteAccess()) await overlay.refreshPersistence();
            } finally {
              setRequesting(false);
            }
          }}
        >
          Cho phép ghi file
        </button>
      )}
    </div>
  );
}

export function OverlayPanel({ mode, chatData, overlay, onClose, onJumpToMessage, onRequestWriteAccess, onFavoritesFileSaved, onOpenChat }: OverlayPanelProps) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [savedChat, setSavedChat] = useState<ChatListEntry | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { setLimit(PAGE_SIZE); setExportStatus(null); setSavedChat(null); }, [mode, chatData]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const indices = useMemo(() => {
    if (mode === 'favorites') return [...overlay.favoritesByIndex.keys()].sort((a, b) => a - b);
    const result: number[] = [];
    for (let index = 0; index < overlay.deletedMask.length; index++) if (overlay.deletedMask[index]) result.push(index);
    return result;
  }, [mode, overlay.favoritesByIndex, overlay.deletedMask]);

  const title = mode === 'favorites' ? `Favorites (${indices.length})` : `Đã xóa (${indices.length})`;

  const exportCleaned = async () => {
    setExporting(true);
    setExportStatus(null);
    try {
      const result = await overlay.exportCleaned();
      setExportStatus(result.mode === 'file'
        ? `Đã ghi ${result.fileName} (bỏ ${result.removed} tin). File gốc giữ nguyên.`
        : `Đã tải ${result.fileName} (bỏ ${result.removed} tin).`);
    } catch (error) {
      console.error('Failed to export cleaned conversation:', error);
      setExportStatus('Không xuất được bản sạch.');
    } finally {
      setExporting(false);
    }
  };

  const saveFavorites = async () => {
    setExporting(true);
    setExportStatus(null);
    setSavedChat(null);
    try {
      const result = await overlay.exportFavorites();
      if (result.mode === 'file') {
        const entry = await onFavoritesFileSaved?.(result.fileName).catch(() => null) ?? null;
        setSavedChat(entry);
        setExportStatus(`Đã lưu ${result.fileName} (${result.count} tin).${entry ? ' Chat Favorites đã có trong danh sách chat.' : ''}`);
      } else {
        setExportStatus(`Đã tải ${result.fileName} (${result.count} tin). Đặt file cạnh file gốc rồi mở lại thư mục để xem như một chat.`);
      }
    } catch (error) {
      console.error('Failed to save favorites:', error);
      setExportStatus('Không lưu được file favorites.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <aside className="overlay-panel" aria-label={mode === 'favorites' ? 'Favorites' : 'Tin nhắn đã xóa'}>
      <div className="overlay-panel-header">
        {mode === 'favorites' ? <Star size={18} aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}
        <h4>{title}</h4>
        <button type="button" className="chat-overlay-btn" aria-label="Đóng" onClick={onClose}><X size={18} /></button>
      </div>
      <PersistenceStatus overlay={overlay} onRequestWriteAccess={onRequestWriteAccess} />
      {mode === 'deleted' && (
        <div className="overlay-panel-toolbar">
          <button
            type="button"
            className="overlay-small-btn"
            disabled={indices.length === 0}
            onClick={() => overlay.restoreMessages(indices.map(index => overlay.messageIds[index]))}
          >
            <RotateCcw size={14} aria-hidden="true" />Khôi phục tất cả
          </button>
          <button type="button" className="overlay-small-btn" disabled={exporting} onClick={() => void exportCleaned()}>
            <FileDown size={14} aria-hidden="true" />Export bản sạch
          </button>
          <button type="button" className="overlay-small-btn" onClick={overlay.exportOverlay}>
            <Download size={14} aria-hidden="true" />Export overlay
          </button>
          {exportStatus && <span className="overlay-item-meta" role="status">{exportStatus}</span>}
        </div>
      )}
      {mode === 'favorites' && (
        <div className="overlay-panel-toolbar">
          <button
            type="button"
            className="overlay-small-btn"
            disabled={exporting || indices.every(index => overlay.deletedMask[index])}
            title="Lưu các tin favorite thành một chat riêng (file .favorites.json cạnh file gốc)"
            onClick={() => void saveFavorites()}
          >
            <Save size={14} aria-hidden="true" />Lưu file favorites
          </button>
          {savedChat && onOpenChat && (
            <button type="button" className="overlay-small-btn" onClick={() => onOpenChat(savedChat)}>
              <MessageSquare size={14} aria-hidden="true" />Mở chat Favorites
            </button>
          )}
          {overlay.persistence !== 'file' && (
            <button type="button" className="overlay-small-btn" onClick={overlay.exportOverlay}>
              <Download size={14} aria-hidden="true" />Export overlay
            </button>
          )}
          {exportStatus && <span className="overlay-item-meta" role="status">{exportStatus}</span>}
        </div>
      )}
      <div className="overlay-panel-list">
        {indices.length === 0 && (
          <p className="overlay-panel-empty">
            {mode === 'favorites' ? 'Chưa có tin favorite. Rê chuột vào tin nhắn và bấm ☆.' : 'Chưa xóa tin nào.'}
          </p>
        )}
        {indices.slice(0, limit).map(index => {
          const msg = chatData.messages[index];
          if (!msg) return null;
          const favorite = overlay.favoritesByIndex.get(index);
          const deleted = !!overlay.deletedMask[index];
          return (
            <div key={overlay.messageIds[index] ?? index} className="overlay-item">
              <button
                type="button"
                className="overlay-item-main"
                disabled={deleted}
                title={deleted ? 'Tin này đã bị xóa; khôi phục để xem trong chat.' : 'Đi tới tin nhắn'}
                onClick={() => onJumpToMessage(index)}
              >
                <span className="overlay-item-text">{describeMessage(msg)}</span>
                <MessageMeta msg={msg} />
              </button>
              <div className="overlay-item-row">
                {mode === 'favorites' && favorite && (
                  <>
                    <FavoriteNote favorite={favorite} onSave={note => overlay.setFavoriteNote(favorite.id, note)} />
                    {deleted && <span className="overlay-item-meta">(đã xóa)</span>}
                    <button type="button" className="overlay-small-btn" onClick={() => overlay.toggleFavorite(index)}>
                      Bỏ
                    </button>
                  </>
                )}
                {mode === 'deleted' && (
                  <button
                    type="button"
                    className="overlay-small-btn"
                    onClick={() => overlay.restoreMessages([overlay.messageIds[index]])}
                  >
                    <RotateCcw size={14} aria-hidden="true" />Khôi phục
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {indices.length > limit && (
          <button type="button" className="overlay-small-btn overlay-more" onClick={() => setLimit(value => value + PAGE_SIZE)}>
            Xem thêm ({indices.length - limit})
          </button>
        )}
      </div>
    </aside>
  );
}
