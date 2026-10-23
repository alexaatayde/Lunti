import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../theme';
import { AppText } from './AppText';

export type PageTitleProps = {
  title: string;
  eyebrow?: string;
  /** Optional element on the right, e.g. the "+" button on Transactions. */
  action?: ReactNode;
};

/** Eyebrow + page title (+ optional action), Transactions.html / Home.html. */
export function PageTitle({ title, eyebrow, action }: PageTitleProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        {eyebrow ? (
          <AppText variant="eyebrow" style={styles.eyebrow}>
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant="pageTitle" accessibilityRole="header">
          {title}
        </AppText>
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  text: { flex: 1 },
  eyebrow: { marginBottom: spacing.xs },
  action: { marginLeft: spacing.md, flexShrink: 0 },
});
