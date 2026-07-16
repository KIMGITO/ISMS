import { useAuthStore } from "./authStore";
import { useInventoryStore } from "./inventoryStore";
import { useCustomerStore } from "./customerStore";
import { useCartStore } from "./cartStore";
import { useTransactionStore } from "./transactionStore";
import { useNotificationStore } from "./notificationStore";
import { useUiStore } from "./uiStore";
import { useBusinessStore } from "./businessStore";

/**
 * Backwards-compatible facade hook that aggregates all separate, modular stores
 * into a single unified workspace. This physically separates the features, states,
 * and actions into individual stores while providing seamless integration for existing views.
 */
export const useAppStore = () => {
  const auth = useAuthStore();
  const inventory = useInventoryStore();
  const customer = useCustomerStore();
  const cart = useCartStore();
  const transaction = useTransactionStore();
  const notification = useNotificationStore();
  const ui = useUiStore();
  const business = useBusinessStore();

  const activeBusinessId = business.activeBusinessId;

  const productArray = Array.isArray(inventory?.products) ? inventory.products : [];
  const filteredProducts = productArray.filter(
    (p) => p.businessId === activeBusinessId
  );

  const customerArray = Array.isArray(customer?.customers) ? customer.customers : [];
  const filteredCustomers = customerArray.filter(
    (c) => c.businessId === activeBusinessId
  );

  const transactionArray = Array.isArray(transaction?.transactions) ? transaction.transactions : [];
  const filteredTransactions = transactionArray.filter(
    (t) => t.businessId === activeBusinessId
  );

  return {
    // Business Store
    businesses: business.businesses,
    activeBusinessId: business.activeBusinessId,
    setActiveBusinessId: business.setActiveBusinessId,
    addBusiness: business.addBusiness,
    updateBusiness: business.updateBusiness,
    deleteBusiness: business.deleteBusiness,

    // Auth Store
    employees: auth.employees,
    currentEmployee: auth.currentEmployee,
    activeShift: auth.activeShift,
    shifts: auth.shifts,
    login: auth.login,
    logout: auth.logout,
    punchIn: auth.punchIn,
    punchOut: auth.punchOut,
    toggleTask: auth.toggleTask,
    updateEmployeePin: auth.updateEmployeePin,
    createWorker: auth.createWorker,
    deleteWorker: auth.deleteWorker,
    setupNewWorkerPin: auth.setupNewWorkerPin,
    updateProfile: auth.updateProfile,

    // Online Auth & Onboarding State & Actions
    users: auth.users,
    memberships: auth.memberships,
    invitations: auth.invitations,
    currentUser: auth.currentUser,
    currentBusinessId: auth.currentBusinessId,
    emailVerificationCode: auth.emailVerificationCode,
    ownerExists: auth.ownerExists,
    isInitializing: auth.isInitializing,
    initializationError: auth.initializationError,
    checkOwnerExists: auth.checkOwnerExists,
    performInitialization: auth.performInitialization,
    signUpOwner: auth.signUpOwner,
    verifyEmailCode: auth.verifyEmailCode,
    createBusinessWithOwner: auth.createBusinessWithOwner,
    loginOnline: auth.loginOnline,
    inviteUser: auth.inviteUser,
    verifyInvitation: auth.verifyInvitation,
    acceptInvitation: auth.acceptInvitation,
    switchBusiness: auth.switchBusiness,
    revokeInvitation: auth.revokeInvitation,
    sendPasswordResetOtp: auth.sendPasswordResetOtp,
    verifyPasswordResetOtp: auth.verifyPasswordResetOtp,
    updatePassword: auth.updatePassword,
    updateEmailDuringVerification: auth.updateEmailDuringVerification,

    // Inventory Store (Filtered)
    products: filteredProducts,
    allProductsRaw: inventory.products, 
    adjustments: inventory.adjustments,
    adjustStock: inventory.adjustStock,
    addProduct: inventory.addProduct,
    updateProduct: inventory.updateProduct,
    deleteProduct: inventory.deleteProduct,
    categories: inventory.categories,
    addCategory: inventory.addCategory,
    updateCategory: inventory.updateCategory,

    // Customer Store (Filtered)
    customers: filteredCustomers,
    allCustomersRaw: customer.customers, 
    addCustomer: customer.addCustomer,
    updateCustomer: customer.updateCustomer,
    deleteCustomer: customer.deleteCustomer,
    payCustomerDebt: customer.payCustomerDebt,
    depositCustomerWallet: customer.depositCustomerWallet,
    spendCustomerWallet: customer.spendCustomerWallet,
    adjustCustomerDebt: customer.adjustCustomerDebt,

    // Cart Store
    cart: cart.cart,
    selectedCustomer: cart.selectedCustomer,
    addToCart: cart.addToCart,
    removeFromCart: cart.removeFromCart,
    updateCartQty: cart.updateCartQty,
    updateCartDiscount: cart.updateCartDiscount,
    clearCart: cart.clearCart,
    selectCustomer: cart.selectCustomer,
    checkout: cart.checkout,

    // Transaction / Live Server Sync Store (Filtered)
    transactions: filteredTransactions,
    allTransactionsRaw: transaction.transactions, 
    debtPayments: transaction.debtPayments,
    isOnline: transaction.isOnline,
    isSyncing: transaction.isSyncing,
    lastSyncedAt: transaction.lastSyncedAt,
    toggleNetwork: transaction.toggleNetwork,
    syncWithServer: transaction.syncWithServer,
    loadTransactionsFromServer: transaction.loadTransactionsFromServer,

    // Notification Store
    toast: notification.toast,
    showToast: notification.showToast,
    clearToast: notification.clearToast,

    // UI Store
    showNav: ui.showNav,
    setShowNav: ui.setShowNav,
    aiChatHistory: ui.aiChatHistory,
    setAiChatHistory: ui.setAiChatHistory,
    selectedCustomerId: ui.selectedCustomerId,
    setSelectedCustomerId: ui.setSelectedCustomerId,
    activeInvoiceData: ui.activeInvoiceData,
    setActiveInvoiceData: ui.setActiveInvoiceData,
    activeTab: ui.activeTab,
    setActiveTab: ui.setActiveTab,
    aiIsLoading: ui.aiIsLoading,
    setAiIsLoading: ui.setAiIsLoading,
  };
};

export type AppStore = ReturnType<typeof useAppStore>;