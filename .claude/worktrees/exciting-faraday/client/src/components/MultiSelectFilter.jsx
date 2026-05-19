import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import './MultiSelectFilter.css';

const DEFAULT_STATUS_COLORS = {
  ACTIVE: '#16a34a',
  PAUSED: '#ea580c',
  ARCHIVED: '#64748b',
  ENDED: '#64748b',
  REJECTED: '#dc2626',
  IN_REVIEW: '#d97706',
  PENDING_REVIEW: '#d97706',
  LEARNING: '#d97706',
};

const DEFAULT_STATUS_COLOR = '#94a3b8';

const MultiSelectFilter = ({
  label,
  emoji,
  options = [],
  selectedValues = [],
  onChange,
  placeholder = "All",
  getOptionLabel = (opt) => opt.name || opt.label || opt,
  getOptionValue = (opt) => opt.id || opt.value || opt,
  getOptionStatus,
  statusColors = DEFAULT_STATUS_COLORS,
  disabled = false,
  loading = false,
  maxHeight = '300px',
  singleSelect = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [menuPosition, setMenuPosition] = useState(null);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Position portaled menu with fixed coordinates from trigger — prevents shift when parent reflows
  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) {
      setMenuPosition(null);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedMenuHeight = 360;
    const openAbove = spaceBelow < estimatedMenuHeight && rect.top > spaceBelow;
    const width = Math.min(Math.max(rect.width, 250), 320);
    setMenuPosition({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      width,
      openAbove,
    });
  }, [isOpen, selectedValues, options]);

  // Close dropdown when clicking outside (trigger area or portaled menu)
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && dropdownRef.current.contains(event.target)) return;
      if (menuRef.current && menuRef.current.contains(event.target)) return;
      setIsOpen(false);
      setSearchTerm('');
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Filter options based on search term
  const filteredBySearch = options.filter(option => {
    const label = getOptionLabel(option);
    return label.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Sort: Active first (A–Z), then inactive/paused (A–Z)
  const sortByLabel = (a, b) => (getOptionLabel(a) || '').localeCompare(getOptionLabel(b) || '', undefined, { sensitivity: 'base' });
  const filteredOptions = getOptionStatus
    ? (() => {
        const active = filteredBySearch.filter(opt => (getOptionStatus(opt) || '').toUpperCase() === 'ACTIVE');
        const inactive = filteredBySearch.filter(opt => (getOptionStatus(opt) || '').toUpperCase() !== 'ACTIVE');
        return [...active.sort(sortByLabel), ...inactive.sort(sortByLabel)];
      })()
    : filteredBySearch;

  // Handle checkbox toggle (multi) or single selection
  const handleToggle = (value) => {
    if (singleSelect) {
      const alreadySelected = selectedValues.includes(value);
      onChange(alreadySelected ? [] : [value]);
      setIsOpen(false);
      return;
    }
    const newSelected = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value];
    onChange(newSelected);
  };

  // Handle select all (only for multi-select)
  const handleSelectAll = () => {
    if (singleSelect) return;
    if (selectedValues.length === filteredOptions.length) {
      onChange([]);
    } else {
      const allValues = filteredOptions.map(opt => getOptionValue(opt));
      onChange(allValues);
    }
  };

  // Get display text
  const getDisplayText = () => {
    if (loading) {
      return 'Loading...';
    }
    if (selectedValues.length === 0) {
      return placeholder;
    }
    if (singleSelect && selectedValues.length === 1) {
      const selectedOption = options.find(opt => getOptionValue(opt) === selectedValues[0]);
      return selectedOption ? getOptionLabel(selectedOption) : placeholder;
    }
    // Check if all options are selected (multi only)
    if (!singleSelect && filteredOptions.length > 0 && filteredOptions.every(opt => selectedValues.includes(getOptionValue(opt)))) {
      return placeholder; // Show "All Campaigns" or "All Ads" when all selected
    }
    if (selectedValues.length === 1) {
      const selectedOption = options.find(opt => getOptionValue(opt) === selectedValues[0]);
      return selectedOption ? getOptionLabel(selectedOption) : `${selectedValues.length} item`;
    }
    return `${selectedValues.length} items`;
  };

  const allSelected = filteredOptions.length > 0 && 
    filteredOptions.every(opt => selectedValues.includes(getOptionValue(opt)));

  const radioName = singleSelect ? `filter-${label}` : undefined;

  return (
    <div className="multi-select-filter-wrapper" ref={dropdownRef}>
      <label className="filter-label">
        <span className="filter-emoji">{emoji}</span> {label}
      </label>
      <div className="multi-select-dropdown">
        <button
          ref={triggerRef}
          type="button"
          className={`multi-select-button ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          title={getDisplayText()}
        >
          <span className="multi-select-button-text">{getDisplayText()}</span>
          <i className={`fas fa-chevron-down multi-select-arrow ${isOpen ? 'rotated' : ''}`}></i>
        </button>

        {isOpen && menuPosition && createPortal(
          <div
            ref={menuRef}
            className={`multi-select-dropdown-menu multi-select-dropdown-menu-portal ${menuPosition.openAbove ? 'open-above' : ''}`}
            style={{
              position: 'fixed',
              left: menuPosition.left,
              width: menuPosition.width,
              minWidth: 250,
              maxWidth: 320,
              ...(menuPosition.openAbove
                ? { bottom: window.innerHeight - menuPosition.top + 8, top: 'auto' }
                : { top: menuPosition.bottom + 8, bottom: 'auto' }),
            }}
          >
            {/* Search Input */}
            <div className="multi-select-search">
              <i className="fas fa-search multi-select-search-icon"></i>
              <input
                type="text"
                className="multi-select-search-input"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Select All Option - only for multi-select */}
            {!singleSelect && filteredOptions.length > 0 && (
              <div className="multi-select-item multi-select-item-all">
                <label className="multi-select-checkbox-label">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleSelectAll}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="multi-select-checkbox-text">Select All</span>
                </label>
              </div>
            )}

            {/* Options List */}
            <div className="multi-select-options" style={{ maxHeight }}>
              {loading && options.length === 0 ? (
                <div className="multi-select-no-results">Loading...</div>
              ) : filteredOptions.length === 0 ? (
                <div className="multi-select-no-results">No results found</div>
              ) : (
                filteredOptions.map((option) => {
                  const value = getOptionValue(option);
                  const label = getOptionLabel(option);
                  const isSelected = selectedValues.includes(value);
                  const status = getOptionStatus ? getOptionStatus(option) : null;
                  const isActive = (status || '').toUpperCase() === 'ACTIVE';
                  const statusColor = status
                    ? (statusColors[status] || DEFAULT_STATUS_COLOR)
                    : DEFAULT_STATUS_COLOR;

                  return (
                    <div
                      key={value}
                      className={`multi-select-item ${isSelected ? 'selected' : ''} ${isActive ? 'multi-select-item-active' : ''}`}
                      onClick={() => handleToggle(value)}
                    >
                      <label className="multi-select-checkbox-label">
                        <input
                          type={singleSelect ? 'radio' : 'checkbox'}
                          name={radioName}
                          checked={isSelected}
                          onChange={() => handleToggle(value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {getOptionStatus && status && (
                          <span
                            className="multi-select-status-dot"
                            style={{ backgroundColor: statusColor }}
                            title={status}
                            aria-hidden
                          />
                        )}
                        <span className="multi-select-checkbox-text">
                          {label}
                          {getOptionStatus && status && (
                            <span className="multi-select-status-label">{status}</span>
                          )}
                        </span>
                      </label>
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
};

export default MultiSelectFilter;
