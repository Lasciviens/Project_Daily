// Whether an item is CONFIRMED to be on its calendar after a save (Apple Calendar since Google Calendar went,
// 25.11.2026: itemCalendar.settleItemApple reads the row's icloud_area after the queue was sent):
//   'linked'     — confirmed there;
//   'not_linked' — confirmed not there;
//   'unknown'    — not confirmed either way (iCloud didn't answer, the queue is busy). A caller deciding whether it
//                  is safe to drop the item's OTHER copy (its Google Task) must NEVER act on 'unknown'.
export type TimeBlockCalendarStatus = 'linked' | 'not_linked' | 'unknown'
