const TimeSlot = require('../models/TimeSlot');

const TZ_OFFSET_HOURS = 7;

/**
 * Convert a local (UTC+7) date + time into a real UTC Date object
 */
function toUTCDate(dateStr, hour, minute) {
  const d = new Date(dateStr);
  d.setHours(hour - TZ_OFFSET_HOURS, minute, 0, 0);
  return d;
}

/**
 * Get UTC range for a local (UTC+7) day
 */
function getUTCDayRange(dateStr) {
  const start = new Date(dateStr);
  start.setHours(0 - TZ_OFFSET_HOURS, 0, 0, 0);

  const end = new Date(dateStr);
  end.setHours(23 - TZ_OFFSET_HOURS, 59, 59, 999);

  return { start, end };
}

/**
 * Auto-generate 1-hour time slots for a room on a given date (UTC+7 aware)
 */
async function generateDailySlots(
  roomId,
  dateStr,
  openTime = '08:00',
  closeTime = '20:00'
) {
  const [openHour, openMin] = openTime.split(':').map(Number);
  const [closeHour, closeMin] = closeTime.split(':').map(Number);

  const { start: startOfDay, end: endOfDay } = getUTCDayRange(dateStr);

  // Fetch existing slots
  const existing = await TimeSlot.find({
    room: roomId,
    startTime: { $gte: startOfDay, $lte: endOfDay }
  });

  const existingStarts = new Set(
    existing.map(s => new Date(s.startTime).getTime())
  );

  const toCreate = [];

  // Start cursor in UTC (converted from UTC+7)
  let cursor = toUTCDate(dateStr, openHour, openMin);
  const closeDate = toUTCDate(dateStr, closeHour, closeMin);

  while (cursor < closeDate) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(cursor);
    slotEnd.setHours(slotEnd.getHours() + 1);

    if (slotEnd > closeDate) break;

    if (!existingStarts.has(slotStart.getTime())) {
      toCreate.push({
        room: roomId,
        startTime: slotStart,
        endTime: slotEnd
      });
    }

    cursor.setHours(cursor.getHours() + 1);
  }

  if (toCreate.length > 0) {
    await TimeSlot.insertMany(toCreate, { ordered: false });
  }

  return TimeSlot.find({
    room: roomId,
    startTime: { $gte: startOfDay, $lte: endOfDay }
  }).sort({ startTime: 1 });
}

module.exports = { generateDailySlots };