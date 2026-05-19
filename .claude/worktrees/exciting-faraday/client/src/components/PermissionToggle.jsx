import React from 'react';
import './PermissionToggle.css';

export default function PermissionToggle({ 
  checked, 
  onChange, 
  disabled = false,
  label,
  description 
}) {
  return (
    <div className="permission-toggle-wrapper">
      <div className="permission-toggle-content">
        {label && (
          <div className="permission-toggle-label-group">
            <label className="permission-toggle-label">{label}</label>
            {description && (
              <span className="permission-toggle-description">{description}</span>
            )}
          </div>
        )}
        <div className={`permission-toggle-switch ${disabled ? 'disabled' : ''}`}>
          <input
            type="checkbox"
            id={`toggle-${label?.replace(/\s+/g, '-').toLowerCase() || 'default'}`}
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            className="permission-toggle-input"
          />
          <label
            htmlFor={`toggle-${label?.replace(/\s+/g, '-').toLowerCase() || 'default'}`}
            className="permission-toggle-slider"
          />
        </div>
      </div>
    </div>
  );
}
