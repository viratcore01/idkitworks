import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  id?: string;
  minLength?: number;
}

/** Password input with a show/hide eye toggle. */
export default function PasswordInput({ value, onChange, placeholder = '••••••••', required, autoComplete = 'current-password', id, minLength }: Props) {
  const [show, setShow] = useState(false);
  return (
  <div className="relative">
  <input
  id={id}
  type={show ? 'text' : 'password'}
  className="nb-input pr-12"
  placeholder={placeholder}
  value={value}
  onChange={(e) => onChange(e.target.value)}
  required={required}
  autoComplete={autoComplete}
  minLength={minLength}
  />
  <button
  type="button"
  onClick={() => setShow((s) => !s)}
  aria-label={show ? 'Hide password' : 'Show password'}
  aria-pressed={show}
  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center text-gray-400 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nb-violet"
  >
  {show ? <EyeOff size={17} /> : <Eye size={17} />}
  </button>
  </div>
  );
}
