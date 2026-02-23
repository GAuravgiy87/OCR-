/**
 * Toast Notification Component
 * 
 * A reusable popup notification system that replaces native browser alert() dialogs.
 * Provides visual feedback for user actions with automatic dismissal.
 * 
 * Features:
 * - 4 types: success (green), error (red), info (blue), warning (yellow)
 * - Auto-dismisses after configurable duration (default: 5 seconds)
 * - Slide-in animation from right side
 * - Manual close button
 * - Positioned at top-right of screen
 * - Accessible with proper ARIA attributes
 * 
 * Usage:
 * ```tsx
 * const [toast, setToast] = useState<{message: string, type: ToastType} | null>(null);
 * 
 * const showToast = (message: string, type: ToastType = 'info') => {
 *   setToast({ message, type });
 * };
 * 
 * // In JSX:
 * {toast && (
 *   <Toast
 *     message={toast.message}
 *     type={toast.type}
 *     onClose={() => setToast(null)}
 *   />
 * )}
 * ```
 * 
 * @component
 * @example
 * <Toast message="Document saved!" type="success" onClose={() => {}} />
 */

'use client';

import { useEffect } from 'react';

/**
 * Available toast notification types
 * - success: Green, for successful operations
 * - error: Red, for failed operations or errors
 * - info: Blue, for informational messages
 * - warning: Yellow, for warnings or cautions
 */
export type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * Props for the Toast component
 * 
 * @interface ToastProps
 * @property {string} message - The message to display in the toast
 * @property {ToastType} type - The type of toast (determines color and icon)
 * @property {() => void} onClose - Callback function when toast is closed (manual or auto)
 * @property {number} [duration=5000] - How long to show toast before auto-dismiss (milliseconds)
 */
interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

/**
 * Toast notification component
 * 
 * Displays a temporary notification message with appropriate styling based on type.
 * Automatically dismisses after the specified duration.
 * 
 * @param {ToastProps} props - Component props
 * @returns {JSX.Element} Rendered toast notification
 */
export default function Toast({ message, type, onClose, duration = 5000 }: ToastProps) {
  /**
   * Auto-dismiss effect
   * Sets up a timer to automatically close the toast after the specified duration.
   * Cleans up the timer if component unmounts before duration expires.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    // Cleanup: clear timer if component unmounts
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  /**
   * Get styling configuration based on toast type
   * Returns background color, border color, text color, and appropriate icon
   * 
   * @returns {Object} Style configuration object with bg, border, text, and icon
   */
  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-green-50',
          border: 'border-green-200',
          text: 'text-green-800',
          icon: (
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
        };
      case 'error':
        return {
          bg: 'bg-red-50',
          border: 'border-red-200',
          text: 'text-red-800',
          icon: (
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
        };
      case 'warning':
        return {
          bg: 'bg-yellow-50',
          border: 'border-yellow-200',
          text: 'text-yellow-800',
          icon: (
            <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
        };
      case 'info':
      default:
        return {
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          text: 'text-blue-800',
          icon: (
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
        };
    }
  };

  const styles = getTypeStyles();

  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in-right">
      <div className={`${styles.bg} ${styles.border} border rounded-lg shadow-lg p-4 max-w-md`}>
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex-shrink-0">
            {styles.icon}
          </div>
          
          {/* Message */}
          <div className="flex-1">
            <p className={`text-sm font-medium ${styles.text} whitespace-pre-wrap`}>
              {message}
            </p>
          </div>
          
          {/* Close button */}
          <button
            onClick={onClose}
            className={`flex-shrink-0 ${styles.text} hover:opacity-70 transition-opacity`}
            aria-label="Close notification"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
