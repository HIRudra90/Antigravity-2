import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

export interface Option {
  value: string;
  label: string;
}

interface GlassSelectProps {
  value?: string;
  defaultValue?: string;
  onChange?: (val: string) => void;
  options: Option[];
  style?: React.CSSProperties;
}

export default function GlassSelect({ value, defaultValue, onChange, options, style }: GlassSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [internalVal, setInternalVal] = useState(value !== undefined ? value : defaultValue)
  const containerRef = useRef<HTMLDivElement>(null)

  const currentVal = value !== undefined ? value : internalVal
  const selectedOpt = options.find(o => o.value === currentVal) || options[0]

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleChange = (val: string) => {
    if (value === undefined) {
      setInternalVal(val)
    }
    if (onChange) {
      onChange(val)
    }
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: style?.width || '100%', zIndex: isOpen ? 50 : 1, ...style }}>
      <div 
        className="glass-input" 
        style={{ 
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
          cursor: 'pointer', userSelect: 'none', 
          borderColor: isOpen ? 'rgba(108,99,255,0.5)' : undefined,
          background: isOpen ? 'rgba(108,99,255,0.07)' : undefined,
          boxShadow: isOpen ? '0 0 0 3px rgba(108,99,255,0.12)' : undefined
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{selectedOpt?.label}</span>
        <ChevronDown size={14} style={{ color: 'var(--clr-text-muted)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>

      {isOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, width: '100%',
          background: 'rgba(9, 11, 22, 0.75)', backdropFilter: 'blur(22px) saturate(180%)', WebkitBackdropFilter: 'blur(22px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--r-md)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 9999, overflow: 'hidden', padding: 6,
          animation: 'pageIn 0.2s cubic-bezier(0.4,0,0.2,1) both'
        }}>
          {options.map(opt => (
             <div 
               key={opt.value}
               onClick={() => handleChange(opt.value)}
               style={{
                 padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 'var(--r-sm)',
                 background: currentVal === opt.value ? 'rgba(108,99,255,0.25)' : 'transparent',
                 color: currentVal === opt.value ? '#fff' : 'var(--clr-text)',
                 fontWeight: currentVal === opt.value ? 600 : 400,
                 transition: 'background 0.2s',
               }}
               onMouseEnter={(e) => {
                 if (currentVal !== opt.value) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
               }}
               onMouseLeave={(e) => {
                 if (currentVal !== opt.value) e.currentTarget.style.background = 'transparent'
               }}
             >
               {opt.label}
             </div>
          ))}
        </div>
      )}
    </div>
  )
}
