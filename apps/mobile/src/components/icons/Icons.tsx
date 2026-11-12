/**
 * Small icons used across screens. Paths copied from design/screens/*.html
 * (source file noted per icon). Stroke widths default to what the design uses.
 */
import { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

import { colors } from '../../theme';
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

/** Hide-password toggle (pairs with EyeIcon; not in the design files, standard eye-off shape). */
export function EyeOffIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6" />
      <Path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <Path d="m3 3 18 18" />
    </IconBase>
  );
}

/** SignUp.html (back to "Sign in") */
export function ChevronLeftIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2.2} {...props}>
      <Polyline points="15 18 9 12 15 6" />
    </IconBase>
  );
}

/** Landing.html ("95% pantry match" callout) */
export function BowlIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.9} {...props}>
      <Path d="M3.5 12.5h17a8.5 7 0 0 1-17 0Z" />
      <Path d="M12 12.5c0-3.6 2.2-6.1 6.3-6.6 0 3.6-2.2 6.1-6.3 6.6Z" />
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

/** Transactions.html ("Corner Café", Dining out) */
export function CupIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Path d="M17 8h1a3 3 0 0 1 0 6h-1" />
      <Path d="M3 8h14v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8z" />
      <Path d="M7 2v3M11 2v3" />
    </IconBase>
  );
}

/** TxnCategory.html (Transport) */
export function BusIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Rect x={5} y={3.5} width={14} height={14} rx={3} />
      <Path d="M5 11h14M7.5 17.5v2M16.5 17.5v2" />
    </IconBase>
  );
}

/** TxnCategory.html (Utilities) */
export function BoltIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z" />
    </IconBase>
  );
}

/** TxnCategory.html (Household) */
export function HouseIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <Path d="M9 21v-6h6v6" />
    </IconBase>
  );
}

/** TxnCategory.html (Others): three filled dots. */
export function MoreIcon({ color = colors.text, ...props }: IconProps) {
  return (
    <IconBase defaultStrokeWidth={0} color={color} {...props}>
      <Circle cx={5} cy={12} r={1.8} fill={color} />
      <Circle cx={12} cy={12} r={1.8} fill={color} />
      <Circle cx={19} cy={12} r={1.8} fill={color} />
    </IconBase>
  );
}

/** TxnForm.html ("Items" tile) */
export function ListIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Path d="M9 6h11M9 12h11M9 18h11" />
      <Circle cx={4.5} cy={6} r={0.6} />
      <Circle cx={4.5} cy={12} r={0.6} />
      <Circle cx={4.5} cy={18} r={0.6} />
    </IconBase>
  );
}

// ---------- scan flow (build step 4) ----------

/** ScanCamera.html (Gallery) */
export function ImageIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Rect x={3.5} y={4.5} width={17} height={15} rx={2.5} />
      <Circle cx={9} cy={10} r={1.6} />
      <Path d="m20.5 16-5-5-8 8.5" />
    </IconBase>
  );
}

/** ScanCamera.html (Flash) */
export function FlashIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z" />
    </IconBase>
  );
}

/** ScanFailed.html (hero) */
export function ReceiptQuestionIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.6} {...props}>
      <Path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3Z" />
      <Path d="M10 8.5c0-1.1.9-2 2-2s2 .9 2 2c0 1.4-2 1.6-2 3" />
      <Path d="M12 14.5v.1" />
    </IconBase>
  );
}

/** ScanFailed.html (tip: light) */
export function SunIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
      <Circle cx={12} cy={12} r={3.5} />
    </IconBase>
  );
}

/** ScanFailed.html (tip: flatten) */
export function FlatReceiptIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Rect x={5} y={4} width={14} height={16} rx={2} />
      <Path d="M9 9h6M9 13h6" />
    </IconBase>
  );
}

/** ScanFailed.html (tip: frame) */
export function FrameIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    </IconBase>
  );
}

/** ScanReview.html (Reset) */
export function RefreshIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={2} {...props}>
      <Path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </IconBase>
  );
}

/** ScanReview.html (receipt summary tile) */
export function ReceiptDocIcon(props: IconProps) {
  return (
    <IconBase defaultStrokeWidth={1.8} {...props}>
      <Path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      <Line x1={9} x2={10} y1={8} y2={8} strokeWidth={2} />
    </IconBase>
  );
}
