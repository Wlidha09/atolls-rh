// UTC date-only calculations: each calendar date belongs to one category.
export function monthBounds(year, month) {
  if (!Number.isInteger(year) || year < 1970 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw Object.assign(new Error('Choose a month from 1 to 12 and a year from 1970 to 2100.'), {status: 400});
  }
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {start, end: `${year}-${String(month).padStart(2, '0')}-${days}`, days};
}
export function calculateWorkDays(year, month, holidays = [], leaves = []) {
  const {start, end, days} = monthBounds(year, month);
  const holidayDates = new Set(holidays.map(h => h.date).filter(date => date >= start && date <= end));
  const approved = leaves.filter(l => l.status === 'Approved' && l.start_date <= end && l.end_date >= start);
  const dates = {weekends: [], holidays: [], leave: [], worked: []};
  for (let day = 1; day <= days; day++) {
    const date = `${start.slice(0, 8)}${String(day).padStart(2, '0')}`;
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday === 0 || weekday === 6) dates.weekends.push(date);
    else if (holidayDates.has(date)) dates.holidays.push(date);
    else if (approved.some(l => l.start_date <= date && l.end_date >= date)) dates.leave.push(date);
    else dates.worked.push(date);
  }
  return {totalDays: days, weekends: dates.weekends.length, publicHolidays: dates.holidays.length, approvedLeave: dates.leave.length, netWorkedDays: dates.worked.length};
}
