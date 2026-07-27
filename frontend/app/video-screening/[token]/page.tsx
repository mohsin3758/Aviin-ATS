'use client';
import { useState, useEffect, useRef } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://ats.aviinjobs.com/api';

interface Question { id: string; text: string; time_limit_secs: number; }

export default function VideoScreeningPublicPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [data, setData] = useState<{ candidate_name: string; questions: Question[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [idx, setIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/video/public?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => { if (d.detail) setError(d.detail); else setData(d); })
      .catch(() => setError('Unable to load this screening link.'))
      .finally(() => setLoading(false));
  }, [token]);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; videoRef.current.play(); }
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => stream.getTracks().forEach(t => t.stop());
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  };

  const stopAndSubmit = async (questionId: string) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorder.stop();
    setRecording(false);
    await new Promise(res => setTimeout(res, 300));
    const blob = new Blob(chunksRef.current, { type: 'video/webm' });
    const fd = new FormData();
    fd.append('file', blob, 'response.webm');
    setUploading(true);
    try {
      const r = await fetch(`${API_BASE}/video/public/submit?token=${encodeURIComponent(token)}&question_id=${questionId}`, {
        method: 'POST', body: fd,
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Upload failed'); }
      setSubmitted(s => ({ ...s, [questionId]: true }));
    } catch (e: any) { setError(e.message); }
    finally { setUploading(false); }
  };

  if (loading) return <Center>Loading…</Center>;
  if (error) return <Center><p style={{ color: '#DC2626' }}>{error}</p></Center>;
  if (!data) return null;

  const q = data.questions[idx];
  const allDone = data.questions.every(qq => submitted[qq.id]);

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>Hi {data.candidate_name}</h1>
      <p style={{ color: '#64748B', fontSize: 13, marginBottom: 20 }}>Record a short video answer for each question below.</p>

      {allDone ? (
        <Center><h2>All done — thank you!</h2><p>Your responses have been submitted for review.</p></Center>
      ) : q && (
        <div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Question {idx + 1} of {data.questions.length}</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{q.text}</div>
          <video ref={videoRef} style={{ width: '100%', borderRadius: 12, background: '#0F172A', aspectRatio: '16/9' }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            {!recording && !submitted[q.id] && (
              <button onClick={startRecording} style={{ padding: '10px 20px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>● Start Recording</button>
            )}
            {recording && (
              <button onClick={() => stopAndSubmit(q.id)} disabled={uploading} style={{ padding: '10px 20px', background: '#0F172A', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                {uploading ? 'Uploading…' : 'Stop & Submit'}
              </button>
            )}
            {submitted[q.id] && idx < data.questions.length - 1 && (
              <button onClick={() => setIdx(idx + 1)} style={{ padding: '10px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Next Question →</button>
            )}
            {submitted[q.id] && <span style={{ alignSelf: 'center', fontSize: 12, color: '#16A34A', fontWeight: 700 }}>✓ Submitted</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', fontFamily: 'system-ui' }}>{children}</div>;
}
