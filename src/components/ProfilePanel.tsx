import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Upload, Check, AlertCircle, Loader2, Building2, Mail, KeyRound, Trash2,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useBrand } from '../lib/brand'

type Status = { ok: boolean; msg: string } | null

const MAX_UPLOAD = 4 * 1024 * 1024   // 4 MB before downscaling

/**
 * Downscales and re-encodes a picked image before upload.
 *
 * A phone photo is several megabytes and 4000px wide; the avatar renders at
 * 32px in the sidebar. Shipping the original would mean every page load pulls
 * a multi-megabyte image to draw a thumbnail. 256px JPEG is well beyond what
 * the largest rendering needs and lands around 20KB.
 */
function downscale(file: File, size = 256): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      // Square crop from the centre, so a portrait is not squashed into the circle.
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas is unavailable in this browser.')); return }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
      canvas.toBlob(
        b => b ? resolve(b) : reject(new Error('The image could not be processed.')),
        'image/jpeg', 0.88,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image.')) }
    img.src = url
  })
}

export default function ProfilePanel({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth()
  const { company, avatarUrl, save } = useBrand()

  const [companyDraft, setCompanyDraft] = useState(company)
  const [detailsStatus, setDetailsStatus] = useState<Status>(null)
  const [savingDetails, setSavingDetails] = useState(false)

  const [uploading, setUploading] = useState(false)
  const [avatarStatus, setAvatarStatus] = useState<Status>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [email, setEmail] = useState(profile?.email || '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [credStatus, setCredStatus] = useState<Status>(null)
  const [savingCreds, setSavingCreds] = useState(false)

  async function saveDetails() {
    if (savingDetails) return
    setSavingDetails(true); setDetailsStatus(null)
    try {
      await save({ company: companyDraft.trim() || 'Antigravity Inc.' })
      setDetailsStatus({ ok: true, msg: 'Saved.' })
    } catch (e: any) {
      setDetailsStatus({ ok: false, msg: e?.message || 'Could not save.' })
    } finally {
      setSavingDetails(false)
    }
  }

  async function pickAvatar(file: File) {
    if (!file) return
    if (file.size > MAX_UPLOAD) {
      setAvatarStatus({ ok: false, msg: 'That image is larger than 4 MB. Pick a smaller one.' })
      return
    }
    setUploading(true); setAvatarStatus(null)
    try {
      const blob = await downscale(file)
      // A fresh filename each time: the bucket is public and therefore CDN
      // cached, so overwriting one path would keep serving the old picture.
      const path = `owner-${profile?.id || 'default'}-${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (upErr) throw upErr

      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      await save({ avatarUrl: data.publicUrl })
      setAvatarStatus({ ok: true, msg: 'Picture updated.' })
    } catch (e: any) {
      setAvatarStatus({ ok: false, msg: e?.message || 'The upload failed.' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeAvatar() {
    setUploading(true); setAvatarStatus(null)
    try {
      await save({ avatarUrl: '' })
      setAvatarStatus({ ok: true, msg: 'Picture removed.' })
    } catch (e: any) {
      setAvatarStatus({ ok: false, msg: e?.message || 'Could not remove the picture.' })
    } finally {
      setUploading(false)
    }
  }

  async function saveCredentials() {
    if (savingCreds) return
    const wantsEmail = email.trim() && email.trim() !== profile?.email
    const wantsPassword = password.length > 0

    if (!wantsEmail && !wantsPassword) {
      setCredStatus({ ok: false, msg: 'Change the email or enter a new password first.' })
      return
    }
    if (wantsPassword) {
      if (password.length < 6) {
        setCredStatus({ ok: false, msg: 'A password needs at least 6 characters.' })
        return
      }
      if (password !== confirm) {
        setCredStatus({ ok: false, msg: 'The two passwords do not match.' })
        return
      }
    }

    setSavingCreds(true); setCredStatus(null)
    try {
      const payload: { email?: string; password?: string } = {}
      if (wantsEmail) payload.email = email.trim()
      if (wantsPassword) payload.password = password

      const { error } = await supabase.auth.updateUser(payload)
      if (error) throw error

      // The profiles row carries the email the rest of the app reads, so it
      // has to follow the auth change or the two drift apart.
      if (wantsEmail && profile?.id) {
        await supabase.from('profiles').update({ email: email.trim() }).eq('id', profile.id)
      }

      setPassword(''); setConfirm('')
      setCredStatus({
        ok: true,
        msg: wantsEmail
          // Supabase does not switch the address until the new one is proven.
          ? 'Saved. Check the new address for a confirmation link — the change applies once you click it.'
          : 'Password updated.',
      })
    } catch (e: any) {
      setCredStatus({ ok: false, msg: e?.message || 'The change could not be saved.' })
    } finally {
      setSavingCreds(false)
    }
  }

  const initial = (companyDraft || 'U').charAt(0).toUpperCase()
  const dirty = companyDraft.trim() !== company

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 20,
        background: 'rgba(3,5,14,0.72)', backdropFilter: 'blur(6px)',
      }}
    >
      <div style={{
        width: 'min(520px, 100%)', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto',
        borderRadius: 16, background: 'rgba(10,13,28,0.97)',
        border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 28px 80px rgba(0,0,0,0.7)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.07)', position: 'sticky', top: 0,
          background: 'rgba(10,13,28,0.97)', zIndex: 1,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Profile &amp; Account</span>
          <button onClick={onClose} aria-label="Close"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', display: 'flex', padding: 2 }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Picture ── */}
          <div style={{ display: 'flex', gap: 15, alignItems: 'center' }}>
            <div style={{
              width: 66, height: 66, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
              background: avatarUrl ? '#000' : 'linear-gradient(135deg,#6C63FF,#00D4FF)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 25, fontWeight: 800, color: '#fff',
              border: '1px solid rgba(255,255,255,0.14)',
            }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : initial}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9,
                    background: 'rgba(108,99,255,0.18)', border: '1px solid rgba(108,99,255,0.45)',
                    color: '#a78bfa', fontWeight: 600, fontSize: 12,
                    cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1,
                  }}>
                  {uploading ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}
                  {uploading ? 'Uploading…' : avatarUrl ? 'Change picture' : 'Add picture'}
                </button>
                {avatarUrl && !uploading && (
                  <button onClick={removeAvatar}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 9,
                      background: 'transparent', border: '1px solid rgba(244,63,94,0.35)',
                      color: '#f43f5e', fontWeight: 600, fontSize: 12, cursor: 'pointer',
                    }}>
                    <Trash2 size={12} /> Remove
                  </button>
                )}
              </div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>
                Cropped square and resized to 256px on upload.
              </div>
              {avatarStatus && (
                <div style={{ fontSize: 11, marginTop: 5, color: avatarStatus.ok ? '#22d3a8' : '#f43f5e' }}>
                  {avatarStatus.msg}
                </div>
              )}
            </div>

            <input ref={fileRef} type="file" accept="image/*" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) pickAvatar(f) }} />
          </div>

          {/* ── Company ── */}
          <Section icon={Building2} title="Company">
            <Field label="Company name" hint="Shown in the top bar and the sidebar on every page.">
              <input className="glass-input" style={{ width: '100%' }}
                value={companyDraft} onChange={e => setCompanyDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && dirty) saveDetails() }} />
            </Field>
            <Action onClick={saveDetails} busy={savingDetails} disabled={!dirty}
              label={dirty ? 'Save changes' : 'Saved'} status={detailsStatus} />
          </Section>

          {/* ── Credentials ── */}
          <Section icon={KeyRound} title="Login credentials">
            <Field label="Email" hint="Used to sign in.">
              <div style={{ position: 'relative' }}>
                <Mail size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)' }} />
                <input className="glass-input" style={{ width: '100%', paddingLeft: 32 }}
                  type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </Field>
            <Field label="New password" hint="Leave blank to keep the current one.">
              <input className="glass-input" style={{ width: '100%' }} type="password"
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" autoComplete="new-password" />
            </Field>
            {password.length > 0 && (
              <Field label="Confirm new password">
                <input className="glass-input" style={{ width: '100%' }} type="password"
                  value={confirm} onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password" />
              </Field>
            )}
            <Action onClick={saveCredentials} busy={savingCreds} disabled={false}
              label="Update credentials" status={credStatus} />
          </Section>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'rgba(255,255,255,0.75)' }}>
        <Icon size={13} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: any }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 5 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function Action({ onClick, busy, disabled, label, status }: {
  onClick: () => void; busy: boolean; disabled: boolean; label: string; status: Status
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button onClick={onClick} disabled={busy || disabled}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 15px', borderRadius: 9,
          background: disabled ? 'rgba(255,255,255,0.05)' : 'rgba(108,99,255,0.22)',
          border: `1px solid ${disabled ? 'rgba(255,255,255,0.1)' : 'rgba(108,99,255,0.5)'}`,
          color: disabled ? 'rgba(255,255,255,0.3)' : '#a78bfa',
          fontWeight: 700, fontSize: 12,
          cursor: busy || disabled ? 'default' : 'pointer',
        }}>
        {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
        {busy ? 'Saving…' : label}
      </button>
      {status && (
        <span style={{
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
          color: status.ok ? '#22d3a8' : '#f43f5e', minWidth: 0,
        }}>
          {status.ok ? <Check size={12} /> : <AlertCircle size={12} />}
          {status.msg}
        </span>
      )}
    </div>
  )
}
