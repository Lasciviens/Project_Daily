import { supabase } from '../../../integrations/supabase/client'
import { exchangeCalendarCode, disconnectCalendar } from '../../calendar/api/calendarApi'

// The calendar api takes the client as an argument; these bind it so the
// Connections UI never imports Supabase itself.

export const exchangeGoogleCode = (code: string) => exchangeCalendarCode(supabase, code)

export const disconnectGoogle = () => disconnectCalendar(supabase)
