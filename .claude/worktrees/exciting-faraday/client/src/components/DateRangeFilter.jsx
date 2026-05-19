import React, { useState, useEffect, useRef } from 'react';
import './DateRangeFilter.css';

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'single_day', label: 'Single day' },
  { id: 'today_yesterday', label: 'Today & Yesterday' },
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'last_14_days', label: 'Last 14 days' },
  { id: 'last_28_days', label: 'Last 28 days' },
  { id: 'last_30_days', label: 'Last 30 days' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'maximum', label: 'Maximum' },
  { id: 'custom', label: 'Custom' },
];

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Helper to get IST date
const getISTDate = () => {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
};

// Helper to format date as YYYY-MM-DD in IST
const formatDateIST = (date) => {
  if (!date) return null;
  const d = new Date(date);
  const istDate = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const year = istDate.getFullYear();
  const month = String(istDate.getMonth() + 1).padStart(2, '0');
  const day = String(istDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper to parse YYYY-MM-DD and create date in IST
const parseDateIST = (dateString) => {
  if (!dateString) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
};

// Helper to get Sunday of a given week (week starts on Sunday)
const getSundayOfWeek = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day; // Get Sunday
  const sunday = new Date(d);
  sunday.setDate(diff);
  // Reset time to start of day
  sunday.setHours(0, 0, 0, 0);
  return sunday;
};

// Helper to get Saturday of a given week
const getSaturdayOfWeek = (date) => {
  const sunday = getSundayOfWeek(date);
  const saturday = new Date(sunday.getTime() + 6 * 24 * 60 * 60 * 1000);
  // Reset time to end of day
  saturday.setHours(23, 59, 59, 999);
  return saturday;
};

// Calculate preset dates
const getPresetDates = (presetId) => {
  const today = getISTDate();
  let startDate, endDate;

  switch (presetId) {
    case 'today':
      startDate = new Date(today);
      endDate = new Date(today);
      break;
    case 'yesterday':
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 1);
      endDate = new Date(startDate);
      break;
    case 'single_day':
      endDate = new Date(today);
      endDate.setDate(endDate.getDate() - 1);
      startDate = new Date(endDate);
      break;
    case 'today_yesterday':
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 1);
      endDate = new Date(today);
      break;
    case 'last_7_days':
      // Meta behavior: Last 7 complete days, excluding today
      // If today is 29-Dec, "Last 7 days" = 22-Dec to 28-Dec
      endDate = new Date(today);
      endDate.setDate(endDate.getDate() - 1); // Yesterday (exclude today)
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6); // 7 days before yesterday (7 complete days)
      break;
    case 'last_14_days':
      // Meta behavior: Last 14 complete days, excluding today
      endDate = new Date(today);
      endDate.setDate(endDate.getDate() - 1); // Yesterday (exclude today)
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 13); // 14 days before yesterday
      break;
    case 'last_28_days':
      // Meta behavior: Last 28 complete days, excluding today
      endDate = new Date(today);
      endDate.setDate(endDate.getDate() - 1); // Yesterday (exclude today)
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 27); // 28 days before yesterday
      break;
    case 'last_30_days':
      // Meta behavior: Last 30 complete days, excluding today
      endDate = new Date(today);
      endDate.setDate(endDate.getDate() - 1); // Yesterday (exclude today)
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 29); // 30 days before yesterday
      break;
    case 'this_week':
      startDate = getSundayOfWeek(today);
      endDate = getSaturdayOfWeek(today);
      break;
    case 'last_week':
      const lastWeekSunday = getSundayOfWeek(today);
      lastWeekSunday.setDate(lastWeekSunday.getDate() - 7);
      startDate = lastWeekSunday;
      endDate = getSaturdayOfWeek(startDate);
      break;
    case 'this_month':
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'last_month':
      startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(today.getFullYear(), today.getMonth(), 0);
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'maximum':
      // Set to a very early date
      startDate = new Date(2000, 0, 1);
      endDate = new Date(today);
      break;
    default:
      return null;
  }

  return { startDate, endDate };
};

// Generate calendar days for a month
const getCalendarDays = (year, month) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const days = [];
  
  // Add empty cells for days before month starts
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null);
  }
  
  // Add days of the month
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i));
  }
  
  return days;
};

const DateRangeFilter = ({ isOpen, onClose, onApply, initialValue }) => {
  const [selectedPreset, setSelectedPreset] = useState(initialValue?.range_type || 'this_week');
  const [startDate, setStartDate] = useState(initialValue?.start_date ? parseDateIST(initialValue.start_date) : null);
  const [endDate, setEndDate] = useState(initialValue?.end_date ? parseDateIST(initialValue.end_date) : null);
  const [compareEnabled, setCompareEnabled] = useState(initialValue?.compare?.enabled || false);
  const [compareStartDate, setCompareStartDate] = useState(initialValue?.compare?.start_date ? parseDateIST(initialValue.compare.start_date) : null);
  const [compareEndDate, setCompareEndDate] = useState(initialValue?.compare?.end_date ? parseDateIST(initialValue.compare.end_date) : null);
  const [tempStartDate, setTempStartDate] = useState(null); // For calendar selection
  const [tempCompareStartDate, setTempCompareStartDate] = useState(null); // For compare calendar selection
  const [, setIsSelectingCompare] = useState(false); // Track if selecting compare dates
  const [calendarMonth1, setCalendarMonth1] = useState(() => {
    const today = getISTDate();
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  const [calendarMonth2, setCalendarMonth2] = useState(() => {
    const today = getISTDate();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return { year: nextMonth.getFullYear(), month: nextMonth.getMonth() };
  });
  const [compareCalendarMonth1, setCompareCalendarMonth1] = useState(() => {
    const today = getISTDate();
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  const [compareCalendarMonth2, setCompareCalendarMonth2] = useState(() => {
    const today = getISTDate();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return { year: nextMonth.getFullYear(), month: nextMonth.getMonth() };
  });

  const dropdownRef = useRef(null);

  // Initialize dates based on preset
  useEffect(() => {
    if (selectedPreset && selectedPreset !== 'custom') {
      const dates = getPresetDates(selectedPreset);
      if (dates) {
        setStartDate(dates.startDate);
        setEndDate(dates.endDate);
        setTempStartDate(null);
      }
    }
  }, [selectedPreset]);

  // Update calendar months when dates change
  useEffect(() => {
    if (startDate) {
      setCalendarMonth1({ year: startDate.getFullYear(), month: startDate.getMonth() });
      const nextMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);
      setCalendarMonth2({ year: nextMonth.getFullYear(), month: nextMonth.getMonth() });
    }
  }, [startDate]);

  // Update compare calendar months when compare dates change
  useEffect(() => {
    if (compareStartDate) {
      setCompareCalendarMonth1({ year: compareStartDate.getFullYear(), month: compareStartDate.getMonth() });
      const nextMonth = new Date(compareStartDate.getFullYear(), compareStartDate.getMonth() + 1, 1);
      setCompareCalendarMonth2({ year: nextMonth.getFullYear(), month: nextMonth.getMonth() });
    }
  }, [compareStartDate]);

  // Handle preset selection
  const handlePresetSelect = (presetId) => {
    setSelectedPreset(presetId);
    if (presetId !== 'custom') {
      const dates = getPresetDates(presetId);
      if (dates) {
        setStartDate(dates.startDate);
        setEndDate(dates.endDate);
        setTempStartDate(null);
      }
    }
  };

  // Handle calendar date click
  const handleDateClick = (date, calendarNum) => {
    if (!date) return;

    // If calendarNum is 3, it's the compare calendar
    if (calendarNum === 3) {
      setIsSelectingCompare(true);
      if (!tempCompareStartDate || (tempCompareStartDate && compareEndDate && date < tempCompareStartDate)) {
        setTempCompareStartDate(date);
        setCompareStartDate(date);
        setCompareEndDate(null);
      } else if (tempCompareStartDate && !compareEndDate) {
        if (date >= tempCompareStartDate) {
          setCompareEndDate(date);
          setTempCompareStartDate(null);
        } else {
          setTempCompareStartDate(date);
          setCompareStartDate(date);
          setCompareEndDate(null);
        }
      } else {
        setTempCompareStartDate(date);
        setCompareStartDate(date);
        setCompareEndDate(null);
      }
      return;
    }

    // Main date range selection
    setIsSelectingCompare(false);
    if (selectedPreset === 'single_day') {
      setStartDate(date);
      setEndDate(date);
      setTempStartDate(null);
      return;
    }
    if (!tempStartDate || (tempStartDate && endDate && date < tempStartDate)) {
      setTempStartDate(date);
      setStartDate(date);
      setEndDate(null);
      setSelectedPreset('custom');
    } else if (tempStartDate && !endDate) {
      if (date >= tempStartDate) {
        setEndDate(date);
        setTempStartDate(null);
      } else {
        setTempStartDate(date);
        setStartDate(date);
        setEndDate(null);
      }
      setSelectedPreset('custom');
    } else {
      setTempStartDate(date);
      setStartDate(date);
      setEndDate(null);
      setSelectedPreset('custom');
    }
  };

  // Check if date is in range
  const isDateInRange = (date, rangeStart, rangeEnd) => {
    if (!date || !rangeStart) return false;
    if (!rangeEnd) {
      return formatDateIST(date) === formatDateIST(rangeStart);
    }
    const dateStr = formatDateIST(date);
    const startStr = formatDateIST(rangeStart);
    const endStr = formatDateIST(rangeEnd);
    return dateStr >= startStr && dateStr <= endStr;
  };

  // Check if date is selected (start or end)
  const isDateSelected = (date, selectedStart, selectedEnd) => {
    if (!date) return false;
    const dateStr = formatDateIST(date);
    const startStr = selectedStart ? formatDateIST(selectedStart) : null;
    const endStr = selectedEnd ? formatDateIST(selectedEnd) : null;
    return dateStr === startStr || dateStr === endStr;
  };

  // Navigate calendar months
  const navigateMonth = (calendarNum, direction) => {
    if (calendarNum === 1) {
      const newDate = new Date(calendarMonth1.year, calendarMonth1.month + direction, 1);
      setCalendarMonth1({ year: newDate.getFullYear(), month: newDate.getMonth() });
      // Keep second calendar one month ahead
      const nextMonth = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 1);
      setCalendarMonth2({ year: nextMonth.getFullYear(), month: nextMonth.getMonth() });
    } else if (calendarNum === 2) {
      const newDate = new Date(calendarMonth2.year, calendarMonth2.month + direction, 1);
      setCalendarMonth2({ year: newDate.getFullYear(), month: newDate.getMonth() });
    } else if (calendarNum === 3) {
      // Compare calendar navigation
      const newDate = new Date(compareCalendarMonth1.year, compareCalendarMonth1.month + direction, 1);
      setCompareCalendarMonth1({ year: newDate.getFullYear(), month: newDate.getMonth() });
      const nextMonth = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 1);
      setCompareCalendarMonth2({ year: nextMonth.getFullYear(), month: nextMonth.getMonth() });
    } else if (calendarNum === 4) {
      const newDate = new Date(compareCalendarMonth2.year, compareCalendarMonth2.month + direction, 1);
      setCompareCalendarMonth2({ year: newDate.getFullYear(), month: newDate.getMonth() });
    }
  };

  // Handle apply
  const handleApply = () => {
    if (!startDate || !endDate) {
      alert('Please select a valid date range');
      return;
    }

    // Validate that end date is not before start date
    if (endDate < startDate) {
      alert('End date cannot be before start date');
      return;
    }

    if (compareEnabled && (!compareStartDate || !compareEndDate)) {
      alert('Please select a comparison date range');
      return;
    }
    
    // Log dates being applied for debugging
    console.log('[DateRangeFilter] Applying dates:', {
      range_type: selectedPreset,
      startDate: formatDateIST(startDate),
      endDate: formatDateIST(endDate),
      startDateRaw: startDate,
      endDateRaw: endDate
    });

    // Check for overlapping ranges
    if (compareEnabled) {
      const mainStart = formatDateIST(startDate);
      const mainEnd = formatDateIST(endDate);
      const compStart = formatDateIST(compareStartDate);
      const compEnd = formatDateIST(compareEndDate);

      if (
        (compStart >= mainStart && compStart <= mainEnd) ||
        (compEnd >= mainStart && compEnd <= mainEnd) ||
        (compStart <= mainStart && compEnd >= mainEnd)
      ) {
        alert('Comparison date range cannot overlap with main date range');
        return;
      }
    }

    const payload = {
      range_type: selectedPreset,
      start_date: formatDateIST(startDate),
      end_date: formatDateIST(endDate),
      timezone: 'Asia/Kolkata',
      compare: compareEnabled ? {
        enabled: true,
        start_date: formatDateIST(compareStartDate),
        end_date: formatDateIST(compareEndDate),
      } : {
        enabled: false,
      },
    };

    onApply(payload);
    onClose();
  };

  // Handle cancel
  const handleCancel = () => {
    // Reset to initial values
    setSelectedPreset(initialValue?.range_type || 'this_week');
    setStartDate(initialValue?.start_date ? parseDateIST(initialValue.start_date) : null);
    setEndDate(initialValue?.end_date ? parseDateIST(initialValue.end_date) : null);
    setCompareEnabled(initialValue?.compare?.enabled || false);
    setCompareStartDate(initialValue?.compare?.start_date ? parseDateIST(initialValue.compare.start_date) : null);
    setCompareEndDate(initialValue?.compare?.end_date ? parseDateIST(initialValue.compare.end_date) : null);
    onClose();
  };

  const renderCalendar = (year, month, calendarNum) => {
    const days = getCalendarDays(year, month);
    const today = getISTDate();
    
    // Determine which dates to display based on calendar
    let displayStart, displayEnd;
    if (calendarNum === 3) {
      // Compare calendar
      displayStart = tempCompareStartDate || compareStartDate;
      displayEnd = compareEndDate;
    } else {
      // Main calendar
      displayStart = tempStartDate || startDate;
      displayEnd = endDate;
    }

    return (
      <div className="calendar-month">
        <div className="calendar-header">
          <button
            type="button"
            className="calendar-nav-btn"
            onClick={() => navigateMonth(calendarNum, -1)}
          >
            ←
          </button>
          <div className="calendar-month-year">
            <select
              value={month}
              onChange={(e) => {
                const newDate = new Date(year, parseInt(e.target.value), 1);
                if (calendarNum === 1) {
                  setCalendarMonth1({ year: newDate.getFullYear(), month: newDate.getMonth() });
                } else {
                  setCalendarMonth2({ year: newDate.getFullYear(), month: newDate.getMonth() });
                }
              }}
              className="calendar-month-select"
            >
              {MONTHS.map((m, idx) => (
                <option key={idx} value={idx}>{m}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => {
                const newDate = new Date(parseInt(e.target.value), month, 1);
                if (calendarNum === 1) {
                  setCalendarMonth1({ year: newDate.getFullYear(), month: newDate.getMonth() });
                  const nextMonth = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 1);
                  setCalendarMonth2({ year: nextMonth.getFullYear(), month: nextMonth.getMonth() });
                } else if (calendarNum === 2) {
                  setCalendarMonth2({ year: newDate.getFullYear(), month: newDate.getMonth() });
                } else if (calendarNum === 3) {
                  setCompareCalendarMonth1({ year: newDate.getFullYear(), month: newDate.getMonth() });
                  const nextMonth = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 1);
                  setCompareCalendarMonth2({ year: nextMonth.getFullYear(), month: nextMonth.getMonth() });
                } else if (calendarNum === 4) {
                  setCompareCalendarMonth2({ year: newDate.getFullYear(), month: newDate.getMonth() });
                }
              }}
              className="calendar-year-select"
            >
              {Array.from({ length: 10 }, (_, i) => today.getFullYear() - 2 + i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="calendar-nav-btn"
            onClick={() => navigateMonth(calendarNum, 1)}
          >
            →
          </button>
        </div>
        <div className="calendar-grid">
          {DAYS_OF_WEEK.map(day => (
            <div key={day} className="calendar-day-header">{day}</div>
          ))}
          {days.map((date, idx) => {
            if (!date) {
              return <div key={`empty-${idx}`} className="calendar-day empty"></div>;
            }

            const isToday = formatDateIST(date) === formatDateIST(today);
            const inRange = isDateInRange(date, displayStart, displayEnd);
            const isSelected = isDateSelected(date, displayStart, displayEnd);
            const isStart = displayStart && formatDateIST(date) === formatDateIST(displayStart);
            const isEnd = displayEnd && formatDateIST(date) === formatDateIST(displayEnd);

            return (
              <button
                key={date.getTime()}
                type="button"
                className={`calendar-day ${isToday ? 'today' : ''} ${inRange ? 'in-range' : ''} ${isSelected ? 'selected' : ''} ${isStart ? 'start' : ''} ${isEnd ? 'end' : ''}`}
                onClick={() => handleDateClick(date, calendarNum)}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="date-range-filter-overlay" onClick={onClose}>
      <div className="date-range-filter-modal" onClick={(e) => e.stopPropagation()} ref={dropdownRef}>
        <div className="date-range-filter-header">
          <span className="date-range-filter-title">
            <i className="far fa-calendar-alt"></i>
            {selectedPreset === 'custom' && startDate && endDate
              ? (formatDateIST(startDate) === formatDateIST(endDate)
                  ? formatDateIST(startDate)
                  : `${formatDateIST(startDate)} - ${formatDateIST(endDate)}`)
              : selectedPreset === 'single_day' && startDate && endDate
                ? formatDateIST(startDate)
                : PRESETS.find(p => p.id === selectedPreset)?.label || 'Select Date Range'}
          </span>
          <button type="button" className="date-range-filter-close" onClick={onClose}>×</button>
        </div>

        <div className="date-range-filter-content">
          <div className="date-range-filter-left">
            <h6 className="preset-section-title">Recently used</h6>
            <div className="preset-list">
              {PRESETS.map(preset => (
                <label key={preset.id} className="preset-item">
                  <input
                    type="radio"
                    name="preset"
                    value={preset.id}
                    checked={selectedPreset === preset.id}
                    onChange={() => handlePresetSelect(preset.id)}
                  />
                  <span>{preset.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="date-range-filter-right">
            <div className="calendar-container">
              {renderCalendar(calendarMonth1.year, calendarMonth1.month, 1)}
              {renderCalendar(calendarMonth2.year, calendarMonth2.month, 2)}
            </div>

            <div className="compare-section">
              <label className="compare-checkbox">
                <input
                  type="checkbox"
                  checked={compareEnabled}
                  onChange={(e) => {
                    setCompareEnabled(e.target.checked);
                    if (e.target.checked && !compareStartDate) {
                      // Set default compare range (same duration as main range)
                      if (startDate && endDate) {
                        const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
                        const compareEnd = new Date(startDate);
                        compareEnd.setDate(compareEnd.getDate() - 1);
                        const compareStart = new Date(compareEnd);
                        compareStart.setDate(compareStart.getDate() - daysDiff);
                        setCompareStartDate(compareStart);
                        setCompareEndDate(compareEnd);
                      }
                    }
                  }}
                />
                <span>Compare</span>
              </label>

              {compareEnabled && (
                <div className="compare-calendar">
                  <div className="calendar-container">
                    {renderCalendar(compareCalendarMonth1.year, compareCalendarMonth1.month, 3)}
                    {renderCalendar(compareCalendarMonth2.year, compareCalendarMonth2.month, 4)}
                  </div>
                </div>
              )}
            </div>

            <div className="date-range-filter-footer">
              <div className="timezone-info">Dates are shown in Kolkata Time</div>
              <div className="date-range-filter-actions">
                <button type="button" className="btn-cancel" onClick={handleCancel}>
                  Cancel
                </button>
                <button type="button" className="btn-update" onClick={handleApply}>
                  Update
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DateRangeFilter;

