import React, { useState, useEffect } from 'react'
import { translate } from '../lib/i18n'

const STORAGE_KEY = 'dhara:v1:onboarding_dismissed'

export default function OnboardingHint({ lang = 'en', onDismiss }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  function handleDismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch {
      // ignore
    }
    setDismissed(true)
    if (onDismiss) onDismiss()
  }

  if (dismissed) return null

  return (
    <div
      className="onboarding-hint"
      role="region"
      aria-label={translate('hint_title', lang)}
    >
      <div className="onboarding-hint-content">
        <div className="onboarding-hint-header">
          <span className="onboarding-hint-icon" aria-hidden="true">💡</span>
          <span className="onboarding-hint-title">{translate('hint_title', lang)}</span>
        </div>
        <ol className="onboarding-hint-list">
          <li>{translate('hint_step1', lang)}</li>
          <li>{translate('hint_step2', lang)}</li>
          <li>{translate('hint_step3', lang)}</li>
        </ol>
      </div>
      <button
        type="button"
        className="onboarding-hint-dismiss"
        onClick={handleDismiss}
        aria-label={translate('hint_dismiss', lang)}
      >
        {translate('hint_dismiss', lang)}
      </button>
    </div>
  )
}
