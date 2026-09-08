'use client';
import { useRef, useState, useEffect, CSSProperties } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Table as TableIcon,
  ChevronDown, Minus,
} from 'lucide-react';

// Real constraint (2026-09-09): matches backend/services/rich_text.py's
// RICH_TEXT_FONTS exactly -- reportlab ships only Helvetica/Times-Roman/
// Courier as real built-in PDF fonts (no arbitrary TTF embedding wired
// up), so a wider picker here would silently not do anything on the
// actual generated PDF/DOCX. These 3 real names are also exactly what a
// browser emits from execCommand('fontName', name) -- no label/value
// split needed, what's picked here is what lands in the HTML.
const RESUME_FONTS = ['Arial', 'Times New Roman', 'Courier New'];
// Same real HTML legacy 1-7 scale the proven email-compose rich-text
// editor already uses (frontend/app/(dashboard)/conversations/page.tsx),
// so a size picked here means the same thing a KAE already knows from
// there.
const SIZES: [string, string][] = [['1', '8px'], ['2', '10px'], ['3', '12px'], ['4', '14px'], ['5', '18px'], ['6', '24px'], ['7', '36px']];

interface Props {
  value: string;
  onChange: (html: string) => void;
  minHeight?: string;
  placeholder?: string;
}

export function RichTextEditor({ value, onChange, minHeight = '160px', placeholder }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const [showFont, setShowFont] = useState(false);
  const [showSize, setShowSize] = useState(false);
  const [showTable, setShowTable] = useState(false);

  // contentEditable is inherently uncontrolled -- re-writing innerHTML on
  // every keystroke would reset the cursor. Seeded once from the real
  // incoming value (the auto-extracted summary, or a saved edit re-
  // opened later); every keystroke after that flows out via onChange,
  // never back in, same established pattern as the proven email-compose
  // editor.
  useEffect(() => {
    if (!initialized.current && ref.current) {
      ref.current.innerHTML = value || '';
      initialized.current = true;
    }
  }, [value]);

  const fire = () => onChange(ref.current?.innerHTML || '');

  const exec = (cmd: string, val?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, val);
    fire();
  };

  const insertTable = (rows: number, cols: number) => {
    let html = '<table style="border-collapse:collapse;width:100%;margin:6px 0"><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        const tag = r === 0 ? 'th' : 'td';
        html += `<${tag} style="border:1px solid #cbd5e1;padding:6px 8px;font-size:12px"><br></${tag}>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    ref.current?.focus();
    document.execCommand('insertHTML', false, html);
    setShowTable(false);
    fire();
  };

  const btnStyle: CSSProperties = { padding: '4px 6px', border: 'none', background: 'none', cursor: 'pointer', borderRadius: '4px', color: '#374151' };
  const dividerStyle: CSSProperties = { width: '1px', height: '18px', background: '#e2e8f0', margin: '0 3px' };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
      {/* Same real placeholder technique the proven email-compose editor
          already uses (conversations/page.tsx) -- that page's own <style>
          is local to it, so this component carries its own copy rather
          than depending on a global rule that may not be loaded here. */}
      <style>{`[data-ph]:empty:before{content:attr(data-ph);color:#94a3b8;pointer-events:none}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '5px 8px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <button type="button" onMouseDown={e => { e.preventDefault(); setShowFont(v => !v); setShowSize(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 6px', border: '1px solid #e2e8f0', borderRadius: '5px', background: 'white', cursor: 'pointer', fontSize: '11px', color: '#374151' }}>
            Font <ChevronDown size={9} />
          </button>
          {showFont && (
            <div style={{ position: 'absolute', top: '100%', left: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, minWidth: '140px', padding: '4px 0' }}>
              {RESUME_FONTS.map(f => (
                <div key={f} onMouseDown={() => { exec('fontName', f); setShowFont(false); }}
                  style={{ padding: '7px 14px', cursor: 'pointer', fontSize: '13px', fontFamily: f }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                  {f}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button type="button" onMouseDown={e => { e.preventDefault(); setShowSize(v => !v); setShowFont(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 6px', border: '1px solid #e2e8f0', borderRadius: '5px', background: 'white', cursor: 'pointer', fontSize: '11px', color: '#374151' }}>
            Size <ChevronDown size={9} />
          </button>
          {showSize && (
            <div style={{ position: 'absolute', top: '100%', left: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, minWidth: '70px', padding: '4px 0' }}>
              {SIZES.map(([val, px]) => (
                <div key={val} onMouseDown={() => { exec('fontSize', val); setShowSize(false); }}
                  style={{ padding: '5px 14px', cursor: 'pointer', fontSize: px, color: '#1e293b' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                  {px}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={dividerStyle} />
        {([[Bold, 'bold', 'Bold'], [Italic, 'italic', 'Italic'], [Underline, 'underline', 'Underline'], [Strikethrough, 'strikeThrough', 'Strikethrough']] as const).map(([Ic, cmd, title]) => (
          <button key={cmd} type="button" onMouseDown={e => { e.preventDefault(); exec(cmd); }} title={title} style={btnStyle}
            onMouseEnter={e => (e.currentTarget.style.background = '#e2e8f0')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <Ic size={13} />
          </button>
        ))}
        <div style={dividerStyle} />
        {([[List, 'insertUnorderedList', 'Bullet List'], [ListOrdered, 'insertOrderedList', 'Numbered List']] as const).map(([Ic, cmd, title]) => (
          <button key={cmd} type="button" onMouseDown={e => { e.preventDefault(); exec(cmd); }} title={title} style={btnStyle}
            onMouseEnter={e => (e.currentTarget.style.background = '#e2e8f0')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <Ic size={13} />
          </button>
        ))}
        <div style={dividerStyle} />
        <div style={{ position: 'relative' }}>
          <button type="button" onMouseDown={e => { e.preventDefault(); setShowTable(v => !v); }} title="Insert Table"
            style={{ ...btnStyle, display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', fontWeight: 600 }}
            onMouseEnter={e => (e.currentTarget.style.background = '#e2e8f0')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <TableIcon size={13} /> Table
          </button>
          {showTable && (
            <div style={{ position: 'absolute', top: '100%', left: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, padding: '8px', display: 'flex', gap: '6px' }}>
              {[[2, 2], [3, 2], [4, 3], [5, 3]].map(([r, c]) => (
                <button key={`${r}x${c}`} type="button" onMouseDown={() => insertTable(r, c)}
                  style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', fontSize: '11px', color: '#374151' }}>
                  {r}×{c}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertHorizontalRule'); }} title="Insert Divider" style={btnStyle}
          onMouseEnter={e => (e.currentTarget.style.background = '#e2e8f0')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
          <Minus size={13} />
        </button>
        <div style={dividerStyle} />
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('removeFormat'); }} title="Clear formatting"
          style={{ ...btnStyle, fontSize: '10px', color: '#94a3b8' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#e2e8f0')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
          Clear
        </button>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning onInput={fire}
        data-ph={placeholder}
        style={{ minHeight, maxHeight: '400px', overflowY: 'auto', outline: 'none', padding: '10px 12px', fontSize: '13px', lineHeight: 1.6, color: '#1e293b' }} />
    </div>
  );
}
