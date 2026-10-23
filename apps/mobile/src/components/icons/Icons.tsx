/**
 * Small icons used across screens. Paths copied from design/screens/*.html
 * (source file noted per icon). Stroke widths default to what the design uses.
 */
import { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

import { IconBase, type IconProps } from './Icon';

/** Transactions.html, TxnForm.html (category row) */
export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Polyline points="9 18 15 12 9 6" />
    </IconBase>
  );
}

/** Transactions.html (month filter) */
export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2.4} {...props}>
      <Path d="m6 9 6 6 6-6" />
    </IconBase>
  );
}

/** Transactions.html (add button) */
export function PlusIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2.2} {...props}>
      <Path d="M12 5v14M5 12h14" />
    </IconBase>
  );
}

/** Home.html (Scan receipt FAB), TxnAddSheet.html */
export function CameraIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <Circle cx={12} cy={13} r={3} />
    </IconBase>
  );
}

/** Transactions.html (search field) */
export function SearchIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Circle cx={11} cy={11} r={6.5} />
      <Path d="m20 20-4.2-4.2" />
    </IconBase>
  );
}

/** Transactions.html (month filter), TxnForm.html (date row) */
export function CalendarIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Rect x={4} y={5} width={16} height={15} rx={2.5} />
      <Path d="M4 10h16M9 3v4M15 3v4" />
    </IconBase>
  );
}

/** TxnDelete.html (dialog icon) */
export function TrashIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />
      <Path d="M10 11v5M14 11v5" />
    </IconBase>
  );
}

/** TxnAddSheet.html ("Enter manually") */
export function EditIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Path d="M4 20h4L19 9l-4-4L4 16Z" />
      <Path d="m13.5 6.5 4 4" />
    </IconBase>
  );
}

/** Transactions.dc.html (toast), TxnForm.html (save button) */
export function CheckIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2.4} {...props}>
      <Path d="m5 12.5 4.5 4.5L19 7.5" />
    </IconBase>
  );
}

/** ScanCamera.html (close) */
export function CloseIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Path d="M6 6l12 12M18 6 6 18" />
    </IconBase>
  );
}

/** Home.html ("Use these next") */
export function ClockIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Circle cx={12} cy={12} r={9} />
      <Polyline points="12 7 12 12 15 15" />
    </IconBase>
  );
}

/** Home.html ("Use these first"), SignIn.html (sign-in button) */
export function ArrowRightIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2.2} {...props}>
      <Line x1={5} x2={19} y1={12} y2={12} />
      <Polyline points="12 5 19 12 12 19" />
    </IconBase>
  );
}

/** Transactions.html (header avatar) */
export function UserIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.75} {...props}>
      <Path d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
    </IconBase>
  );
}

/** TxnForm.html (hint line) */
export function InfoIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Circle cx={12} cy={12} r={10} />
      <Path d="M12 16v-4M12 8h.01" />
    </IconBase>
  );
}

/** Budget.html ("Near limit" badge) */
export function AlertTriangleIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2.4} {...props}>
      <Path d="M12 4 2.5 20h19Z" />
      <Path d="M12 10v4" />
    </IconBase>
  );
}

/** Budget.html ("Exceeded" badge) */
export function AlertCircleIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2.4} {...props}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 7.5v5.5M12 16.5v.1" />
    </IconBase>
  );
}

/** SignIn.html (email field) */
export function MailIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Rect x={3} y={5} width={18} height={14} rx={3} />
      <Path d="m4 7 8 6 8-6" />
    </IconBase>
  );
}

/** SignIn.html (password field) */
export function LockIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Rect x={4} y={11} width={16} height={10} rx={2.5} />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </IconBase>
  );
}

/** SignIn.html (show password) */
export function EyeIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <Circle cx={12} cy={12} r={3} />
    </IconBase>
  );
}

/** Transactions.html (grocery row) */
export function BagIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Path d="M16 11V7a4 4 0 0 0-8 0v4M4 9h16l1 11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1L4 9z" />
    </IconBase>
  );
}
