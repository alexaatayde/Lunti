/**
 * Native date / time dialogs (Android first, SRS 2.4). Shown in the app time zone so the
 * picked day matches how the app and API group days.
 */
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { APP_TIME_ZONE } from '../../lib/dates';

type Options = { value: Date; minimumDate?: Date; maximumDate?: Date };

function open(mode: 'date' | 'time', { value, minimumDate, maximumDate }: Options) {
  return new Promise<Date | null>((resolve) => {
    DateTimePickerAndroid.open({
      value,
      mode,
      is24Hour: false,
      minimumDate,
      maximumDate,
      timeZoneName: APP_TIME_ZONE,
      onChange: (event, date) => resolve(event.type === 'set' && date ? date : null),
    });
  });
}

/** Date dialog then time dialog. Null if the user cancels the date. */
export async function pickDateTime(options: Options): Promise<Date | null> {
  const day = await open('date', options);
  if (!day) return null;
  const time = await open('time', { value: day });
  return time ?? day;
}

export function pickDate(options: Options): Promise<Date | null> {
  return open('date', options);
}
