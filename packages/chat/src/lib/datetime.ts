import { format } from "date-fns";

/** "11:38 AM" — the short time shown under a message. */
export function formatTime(date: Date) {
  return format(date, "h:mm a");
}
