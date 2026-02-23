/**
 * Confirmation Modal Component
 * 
 * A reusable modal dialog that replaces native browser confirm() dialogs.
 * Provides a professional, accessible way to confirm destructive or important actions.
 * 
 * Features:
 * - Backdrop overlay to focus attention
 * - Centered modal with scale-in animation
 * - Customizable title, message, and button text
 * - Three visual types: danger (red), warning (yellow), info (blue)
 * - Icon-based visual feedback
 * - Keyboard accessible (ESC to cancel)
 * - Prevents accidental clicks outside modal
 * 
 * Usage:
 * ```tsx
 * const [confirmModal, setConfirmModal] = useState({
 *   isOpen: false,
 *   title: '',
 *   message: '',
 *   onConfirm: () => {}
 * });
 * 
 * const showConfirm = (title: string, message: string, onConfirm: () => void) => {
 *   setConfirmModal({ isOpen: true, title, message, onConfirm });
 * };
 * 
 * // In JSX:
 * <ConfirmModal
 *   isOpen={confirmModal.isOpen}
 *   title={confirmModal.title}
 *   message={confirmModal.message}
 *   onConfirm={() => {
 *     confirmModal.onConfirm();
 *     setConfirmModal({ ...confirmModal, isOpen: false });
 *   }}
 *   onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
 *   type="danger"
 * />
 * ```
 * 
 * @component
 * @example
 * <ConfirmModal
 *   isOpen={true}
 *   title="Delete Document"
 *   message="Are you sure? This cannot be undone."
 *   onConfirm={() => deleteDocument()}
 *   onCancel={() => setOpen(false)}
 *   type="danger"
 * />
 */

'use client';

/**
 * Props for the ConfirmModal component
 * 
 * @interface ConfirmModalProps
 * @property {boolean} isOpen - Whether the modal is currently visible
 * @property {string} title - The title/heading of the modal
 * @property {string} message - The detailed message or question to display
 * @property {string} [confirmText='Confirm'] - Text for the confirm button
 * @property {string} [cancelText='Cancel'] - Text for the cancel button
 * @property {() => void} onConfirm - Callback when user confirms the action
 * @property {() => void} onCancel - Callback when user cancels or closes modal
 * @property {'danger' | 'warning' | 'info'} [type='warning'] - Visual style of the modal
 */
interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  type?: 'danger' | 'warning' | 'info';
}

/**
 * Confirmation modal component
 * 
 * Displays a modal dialog requiring user confirmation before proceeding with an action.
 * Returns null when not open to avoid rendering unnecessary DOM elements.
 * 
 * @param {ConfirmModalProps} props - Component props
 * @returns {JSX.Element | null} Modal dialog or null if not open
 */
export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  type = 'warning',
}: ConfirmModalProps) {
  // Don't render anything if modal is not open
  if (!isOpen) return null;

  /**
   * Get styling configuration based on modal type
   * Returns icon, icon background color, and confirm button styling
   * 
   * @returns {Object} Style configuration with icon, iconBg, and confirmBtn
   */
  const getTypeStyles = () => {
    switch (type) {
      case 'danger':
        return {
          icon: (
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          iconBg: 'bg-red-100',
          confirmBtn: 'bg-red-600 hover:bg-red-700',
        };
      case 'warning':
        return {
          icon: (
            <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          iconBg: 'bg-yellow-100',
          confirmBtn: 'bg-yellow-600 hover:bg-yellow-700',
        };
      case 'info':
      default:
        return {
          icon: (
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          iconBg: 'bg-blue-100',
          confirmBtn: 'bg-blue-600 hover:bg-blue-700',
        };
    }
  };

  const styles = getTypeStyles();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full animate-scale-in">
        {/* Modal Content */}
        <div className="p-6">
          <div className="flex items-start gap-4">
            {/* Icon */}
            <div className={`flex-shrink-0 ${styles.iconBg} rounded-full p-3`}>
              {styles.icon}
            </div>
            
            {/* Title and Message */}
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {title}
              </h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">
                {message}
              </p>
            </div>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="bg-gray-50 px-6 py-4 rounded-b-lg flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${styles.confirmBtn}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
