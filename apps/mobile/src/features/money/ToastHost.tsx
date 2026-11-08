import { useCallback } from 'react';

import { Toast } from '../../components';
import { useToastStore } from '../../stores/toast';

/** Shows the app-wide toast. Mounted once in the root layout. */
export function ToastHost() {
  const { id, message, onUndo, hide } = useToastStore();
  const undo = useCallback(() => {
    hide();
    onUndo?.();
  }, [hide, onUndo]);
  return (
    <Toast
      key={id}
      visible={!!message}
      message={message ?? ''}
      onUndo={onUndo ? undo : undefined}
      onHide={hide}
      duration={onUndo ? 6000 : 4000}
    />
  );
}
