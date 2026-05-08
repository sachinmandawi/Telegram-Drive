import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, Key, Lock, ArrowRight, Settings, ShieldCheck, HelpCircle, ExternalLink, X, Heart, Timer } from "lucide-react";
import { getPublicAssetPath, invokeCommand, isSavedMessagesDefaultStorage, isTauriRuntime, loadAppStore, openExternal, telegramApiDefaults } from '../platform';

type Step = "setup" | "phone" | "code" | "password";

export function AuthWizard({ onLogin }: { onLogin: () => void }) {
    const defaultCredentials = telegramApiDefaults();
    const logoSrc = getPublicAssetPath('logo.svg');
    const [step, setStep] = useState<Step>("setup");
    const [loading, setLoading] = useState(false);
    const isDesktopRuntime = isTauriRuntime();
    const savedMessagesDefault = isSavedMessagesDefaultStorage();

    const [apiId, setApiId] = useState(defaultCredentials.apiId);
    const [apiHash, setApiHash] = useState(defaultCredentials.apiHash);

    const [phone, setPhone] = useState("");
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [floodWait, setFloodWait] = useState<number | null>(null);
    const [showHelp, setShowHelp] = useState(false);
    const [showDonate, setShowDonate] = useState(false);


    useEffect(() => {
        if (!floodWait) return;
        const interval = setInterval(() => {
            setFloodWait(prev => {
                if (prev === null || prev <= 1) return null;
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [floodWait]);

    useEffect(() => {
        const initStore = async () => {
            const hasDefaultCredentials = Boolean(defaultCredentials.apiId && defaultCredentials.apiHash);
            try {
                const store = await loadAppStore('config.json');
                const savedId = await store.get<string>('api_id');
                const savedHash = await store.get<string>('api_hash');

                if (hasDefaultCredentials) {
                    setApiId(defaultCredentials.apiId);
                    setApiHash(defaultCredentials.apiHash);
                    await store.set('api_id', defaultCredentials.apiId);
                    await store.set('api_hash', defaultCredentials.apiHash);
                    await store.save();
                    setStep("phone");
                } else if (savedId && savedHash && savedId !== 'browser') {
                    setApiId(savedId);
                    setApiHash(savedHash);
                }
            } catch {
                if (hasDefaultCredentials) {
                    setApiId(defaultCredentials.apiId);
                    setApiHash(defaultCredentials.apiHash);
                    setStep("phone");
                }
            }
        };
        initStore();
    }, [defaultCredentials.apiHash, defaultCredentials.apiId, isDesktopRuntime]);

    const saveCredentials = async () => {
        try {
            const store = await loadAppStore('config.json');
            await store.set('api_id', apiId);
            await store.set('api_hash', apiHash);
            await store.save();
        } catch {
            // store write failure, non-critical
        }
    };

    const finishLogin = async () => {
        try {
            const store = await loadAppStore('config.json');
            await store.set('auth_complete', true);
            await store.set('activeFolderId', null);
            await store.save();
        } catch {
            // non-critical; the current session is already active
        }
        onLogin();
    };

    const handleSetupSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!isDesktopRuntime && !savedMessagesDefault) {
            await handleBrowserLogin();
            return;
        }

        if (apiId.includes(' ') || apiHash.includes(' ')) {
            setError("API ID and API Hash cannot contain spaces. Please remove any spaces.");
            return;
        }

        if (!apiId || !apiHash) {
            setError("Both API ID and Hash are required.");
            return;
        }
        setError(null);
        await saveCredentials();
        setStep("phone");
    };

    const handleBrowserLogin = async () => {
        setLoading(true);
        setError(null);
        try {
            const store = await loadAppStore('config.json');
            await store.set('api_id', 'browser');
            await store.set('api_hash', 'local-web-storage');
            await store.set('auth_complete', true);
            await store.save();
            onLogin();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    const handlePhoneSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const idInt = parseInt(apiId, 10);
            if (isNaN(idInt)) throw new Error("API ID must be a number");

            await invokeCommand("cmd_auth_request_code", {
                phone,
                apiId: idInt,
                apiHash: apiHash
            });
            setStep("code");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : JSON.stringify(err);
            if (msg.includes("FLOOD_WAIT_")) {
                const parts = msg.split("FLOOD_WAIT_");
                if (parts[1]) {
                    const seconds = parseInt(parts[1]);
                    if (!isNaN(seconds)) {
                        setFloodWait(seconds);
                        return;
                    }
                }
            }
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleCodeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const res = await invokeCommand<{ success: boolean; next_step?: string }>("cmd_auth_sign_in", { code });
            if (res.success) {
                await finishLogin();
            } else if (res.next_step === "password") {
                setStep("password");
            } else {
                setError("Unknown error");
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const res = await invokeCommand<{ success: boolean; next_step?: string }>("cmd_auth_check_password", { password });
            if (res.success) {
                await finishLogin();
            } else {
                setError("Password verification failed.");
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-gradient relative flex min-h-[100dvh] w-full items-center justify-center overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] sm:p-6">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="auth-glass w-full max-w-md rounded-[1.75rem] p-6 shadow-2xl sm:rounded-3xl sm:p-8"
            >
                <div className="text-center mb-8">
                    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center drop-shadow-lg sm:mb-6 sm:h-20 sm:w-20">
                        <img src={logoSrc} alt="Logo" className="w-full h-full" />
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-1 tracking-tight">Telegram Drive</h1>
                    <p className="text-sm text-white/60 font-medium">Self-Hosted Secure Storage</p>
                </div>

                <AnimatePresence mode="wait">
                    {!isDesktopRuntime && !savedMessagesDefault ? (
                        <motion.div
                            key="browser"
                            initial={{ x: 20, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: -20, opacity: 0 }}
                            className="space-y-5"
                        >
                            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl flex gap-3">
                                <ShieldCheck className="w-5 h-5 text-blue-300 shrink-0 mt-0.5" />
                                <p className="text-sm text-blue-100/80 leading-relaxed">
                                    {savedMessagesDefault
                                        ? 'Telegram Saved Messages storage is configured. Open the Telegram Drive desktop app to sign in and upload to Saved Messages.'
                                        : 'Browser mode stores files locally in this browser. Telegram cloud sync is available in the desktop app.'}
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={savedMessagesDefault ? undefined : handleBrowserLogin}
                                disabled={loading || savedMessagesDefault}
                                className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {savedMessagesDefault
                                    ? "Desktop App Required"
                                    : loading ? "Opening..." : <>Open Browser Drive <ArrowRight className="w-5 h-5" /></>}
                            </button>
                        </motion.div>
                    ) : floodWait ? (
                        <motion.div
                            key="flood"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-center space-y-6"
                        >
                            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto animate-pulse">
                                <Timer className="w-8 h-8 text-red-300" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white mb-2">Too Many Requests</h2>
                                <p className="text-sm text-gray-400">Telegram has temporarily limited your actions.</p>
                                <p className="text-sm text-gray-400">Please wait before trying again.</p>
                            </div>

                            <div className="text-5xl font-mono items-center justify-center flex text-blue-400 font-bold">
                                {Math.floor(floodWait / 60)}:{(floodWait % 60).toString().padStart(2, '0')}
                            </div>

                            <p className="text-xs text-red-400/60 mt-4">
                                Do not restart the app. The timer will reset if you do.
                            </p>
                        </motion.div>
                    ) : (
                        <>


                            {step === "setup" && (
                                <motion.form
                                    key="setup"
                                    initial={{ x: 20, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: -20, opacity: 0 }}
                                    onSubmit={handleSetupSubmit}
                                    className="space-y-5"
                                >
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">API ID</label>
                                            <div className="relative">
                                                <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 auth-form-icon" />
                                                <input
                                                    type="text"
                                                    value={apiId}
                                                    onChange={(e) => setApiId(e.target.value)}
                                                    placeholder="12345678"
                                                    className="w-full glass-input rounded-xl pl-12 pr-4 py-3.5 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-all font-mono text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">API Hash</label>
                                            <div className="relative">
                                                <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 auth-form-icon" />
                                                <input
                                                    type="text"
                                                    value={apiHash}
                                                    onChange={(e) => setApiHash(e.target.value)}
                                                    placeholder="abcdef123456..."
                                                    className="w-full glass-input rounded-xl pl-12 pr-4 py-3.5 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-all font-mono text-sm"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/20 active:scale-[0.98]"
                                    >
                                        Configure <Settings className="w-4 h-4" />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setShowHelp(true)}
                                        className="w-full text-xs text-blue-300 hover:text-white transition-colors flex items-center justify-center gap-1.5 py-1"
                                    >
                                        <HelpCircle className="w-3 h-3" />
                                        How do I get my API credentials?
                                    </button>

                                    {import.meta.env.DEV && !savedMessagesDefault && (
                                        <button
                                            type="button"
                                            onClick={() => onLogin()}
                                            className="w-full text-xs text-red-400/60 hover:text-red-300 transition-colors py-1"
                                        >
                                            Dev Mode
                                        </button>
                                    )}
                                </motion.form>
                            )}


                            {step === "phone" && (
                                <motion.form
                                    key="phone"
                                    initial={{ x: 20, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: -20, opacity: 0 }}
                                    onSubmit={handlePhoneSubmit}
                                    className="space-y-6"
                                >
                                    <div className="space-y-2">
                                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Phone Number</label>
                                        <div className="relative">
                                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 auth-form-icon" />
                                            <input
                                                type="tel"
                                                value={phone}
                                                onChange={(e) => setPhone(e.target.value)}
                                                placeholder="+1 234 567 8900"
                                                className="w-full glass-input rounded-xl pl-12 pr-4 py-4 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-all text-lg tracking-wide"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-3">
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="w-full bg-white text-black hover:bg-gray-100 font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {loading ? "Connecting..." : <>Continue <ArrowRight className="w-5 h-5" /></>}
                                        </button>
                                        <button type="button" onClick={() => setStep("setup")} className="text-xs text-gray-500 hover:text-white transition-colors py-2">
                                            Back to Configuration
                                        </button>
                                    </div>
                                </motion.form>
                            )}


                            {step === "code" && (
                                <motion.form
                                    key="code"
                                    initial={{ x: 20, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: -20, opacity: 0 }}
                                    onSubmit={handleCodeSubmit}
                                    className="space-y-6"
                                >
                                    <div className="space-y-2">
                                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Telegram Code</label>
                                        <div className="relative">
                                            <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 auth-form-icon" />
                                            <input
                                                type="text"
                                                value={code}
                                                onChange={(e) => setCode(e.target.value)}
                                                placeholder="1 2 3 4 5"
                                                className="w-full glass-input rounded-xl pl-12 pr-4 py-4 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-all text-2xl tracking-[0.5em] font-mono text-center"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-3">
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="w-full bg-white text-black hover:bg-gray-100 font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg active:scale-[0.98]"
                                        >
                                            {loading ? "Verifying..." : "Sign In"}
                                        </button>
                                        <button type="button" onClick={() => setStep("phone")} className="text-xs text-gray-500 hover:text-white transition-colors py-2">
                                            Change Phone Number
                                        </button>
                                    </div>
                                </motion.form>
                            )}


                            {step === "password" && (
                                <motion.form
                                    key="password"
                                    initial={{ x: 20, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: -20, opacity: 0 }}
                                    onSubmit={handlePasswordSubmit}
                                    className="space-y-6"
                                >
                                    <div className="space-y-2">
                                        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl mb-4">
                                            <p className="text-xs text-blue-300 text-center">
                                                Your account has Two-Factor Authentication enabled.
                                                Please enter your cloud password to continue.
                                            </p>
                                        </div>
                                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Cloud Password</label>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 auth-form-icon" />
                                            <input
                                                type="password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                placeholder="Enter your password"
                                                className="w-full glass-input rounded-xl pl-12 pr-4 py-4 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-all text-lg"
                                                autoFocus
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-3">
                                        <button
                                            type="submit"
                                            disabled={loading || !password}
                                            className="w-full bg-white text-black hover:bg-gray-100 font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {loading ? "Verifying..." : "Unlock"}
                                        </button>
                                        <button type="button" onClick={() => { setStep("code"); setPassword(""); setError(null); }} className="text-xs text-gray-500 hover:text-white transition-colors py-2">
                                            Back to Code Entry
                                        </button>
                                    </div>
                                </motion.form>
                            )}
                        </>
                    )}
                </AnimatePresence>

                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3"
                    >
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-2 shrink-0" />
                        <p className="text-red-400 text-sm leading-snug">{error}</p>
                    </motion.div>
                )}

                <div className="mt-8 pt-4 border-t border-white/5 text-center">
                    <button
                        onClick={() => setShowDonate(true)}
                        className="text-xs text-white/40 hover:text-white transition-colors flex items-center justify-center gap-1.5 mx-auto"
                    >
                        <Heart className="w-3.5 h-3.5 text-red-500/80" />
                        Donate
                    </button>
                </div>
            </motion.div>


            <AnimatePresence>
                {showHelp && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                        onClick={() => setShowHelp(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="glass bg-telegram-surface border border-telegram-border rounded-2xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-xl font-bold text-telegram-text">Getting Started</h2>
                                <button onClick={() => setShowHelp(false)} className="p-2 hover:bg-telegram-hover rounded-lg transition-colors">
                                    <X className="w-5 h-5 text-telegram-subtext" />
                                </button>
                            </div>

                            <div className="space-y-6 text-telegram-text">
                                <div className="p-4 bg-telegram-primary/10 border border-telegram-primary/20 rounded-xl">
                                    <p className="text-sm text-telegram-subtext">
                                        <strong className="text-telegram-primary">Telegram Drive</strong> uses your Telegram account as secure cloud storage. You'll need a Telegram account and API credentials to get started.
                                    </p>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="font-semibold flex items-center gap-2">
                                        <span className="w-6 h-6 bg-telegram-primary text-white text-xs font-bold rounded-full flex items-center justify-center">1</span>
                                        Go to Telegram's Developer Portal
                                    </h3>
                                    <p className="text-sm text-telegram-subtext ml-8">
                                        Visit <button type="button" onClick={(e) => { e.preventDefault(); openExternal('https://my.telegram.org'); }} className="text-telegram-primary underline hover:text-telegram-text cursor-pointer">my.telegram.org</button> and log in with your phone number.
                                    </p>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="font-semibold flex items-center gap-2">
                                        <span className="w-6 h-6 bg-telegram-primary text-white text-xs font-bold rounded-full flex items-center justify-center">2</span>
                                        Create a New Application
                                    </h3>
                                    <p className="text-sm text-telegram-subtext ml-8">
                                        Click on <strong>"API development tools"</strong> and create a new application. Use any name and description you like.
                                    </p>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="font-semibold flex items-center gap-2">
                                        <span className="w-6 h-6 bg-telegram-primary text-white text-xs font-bold rounded-full flex items-center justify-center">3</span>
                                        Copy Your Credentials
                                    </h3>
                                    <p className="text-sm text-telegram-subtext ml-8">
                                        After creating the app, you'll see your <strong>API ID</strong> (a number) and <strong>API Hash</strong> (a string). Copy both and paste them into the fields on the previous screen.
                                    </p>
                                </div>

                                <div className="p-4 bg-telegram-hover rounded-xl border border-telegram-border">
                                    <p className="text-xs text-telegram-subtext">
                                        <strong>Privacy:</strong> Your credentials are stored locally on your device and are never sent to any third-party servers. All data goes directly between you and Telegram.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); openExternal('https://my.telegram.org'); }}
                                    className="w-full bg-telegram-primary text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-telegram-primary/90 transition-colors"
                                >
                                    <ExternalLink className="w-4 h-4" />
                                    Open my.telegram.org
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showDonate && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                        onClick={() => setShowDonate(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="glass bg-telegram-surface border border-telegram-border rounded-2xl p-6 max-w-sm w-full shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="relative flex items-center justify-center mb-6">
                                <h2 className="text-xl font-bold text-telegram-text text-center">
                                    Support the Project
                                </h2>
                                <button onClick={() => setShowDonate(false)} className="absolute right-0 p-2 hover:bg-telegram-hover rounded-lg transition-colors">
                                    <X className="w-5 h-5 text-telegram-subtext" />
                                </button>
                            </div>

                            <div className="space-y-4 text-center">
                                <p className="text-sm text-telegram-subtext mb-6">
                                    If you find Telegram Drive useful, consider supporting its development!
                                </p>

                                <div className="space-y-4">
                                    <button
                                        onClick={() => openExternal('https://github.com/sachinmandawi/Telegram-Drive')}
                                        className="w-full px-4 py-3 rounded-lg bg-telegram-primary text-white font-semibold hover:bg-telegram-primary/90 transition-colors"
                                    >
                                        View GitHub Repository
                                    </button>

                                    <button
                                        onClick={() => openExternal('https://github.com/sachinmandawi')}
                                        className="w-full px-4 py-3 rounded-lg bg-telegram-hover text-telegram-text font-semibold hover:bg-telegram-border transition-colors"
                                    >
                                        Maintainer Profile
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="fixed top-[-20%] left-[-10%] w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none -z-10" />
            <div className="fixed bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-purple-600/10 rounded-full blur-[100px] pointer-events-none -z-10" />
        </div>
    );
}
