import React, { useEffect } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import './HighFiveLanding.css';

// SVG Icons
const RocketIcon = () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
);

const BoltIcon = () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
);

const HeartIcon = () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
);

// Framer Variants
const fadeInUp = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
};

const staggerContainer = {
    hidden: { opacity: 1 },
    visible: { transition: { staggerChildren: 0.2 } }
};

const hoverScale = {
    scale: 1.05,
    transition: { type: "spring", stiffness: 300 }
};

export default function HighFiveLanding() {
    const { scrollYProgress } = useScroll();
    const heroY = useTransform(scrollYProgress, [0, 0.5], [0, 50]);

    useEffect(() => {
        // Change page title
        document.title = "High-Five Look | Boost Results";
        return () => document.title = "Marketing Dashboard";
    }, []);

    return (
        <div className="hf-body min-vh-100 position-relative">
            {/* Navbar (Simple Logo) */}
            <nav className="container pt-4 pb-2 d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center gap-2 fw-bold fs-4">
                    <span className="text-primary">High</span><span>Five</span>
                </div>
                <button className="hf-btn-ghost d-none d-sm-block">Sign In</button>
            </nav>

            {/* Hero Section */}
            <section className="hf-section pt-5 position-relative overflow-hidden">
                <div className="hf-hero-pattern position-absolute top-0 start-0 w-100 h-100" />

                <div className="container position-relative z-1">
                    <div className="row align-items-center">
                        <motion.div
                            className="col-lg-6 mb-5 mb-lg-0"
                            initial="hidden"
                            animate="visible"
                            variants={staggerContainer}
                        >
                            <motion.div variants={fadeInUp} className="d-inline-block px-3 py-1 rounded-pill bg-warning-subtle text-warning-emphasis fw-bold mb-3 small">
                                🚀 Launching Beta
                            </motion.div>
                            <motion.h1 variants={fadeInUp} className="display-3 hf-h1 mb-4">
                                <span className="hf-text-gradient">High-Five</span> to <br />Better Results
                            </motion.h1>
                            <motion.p variants={fadeInUp} className="lead hf-gray mb-4">
                                Boost your conversions with a playful, high-energy approach that builds trust instantly. Join 10,000+ teams claiming victory.
                            </motion.p>
                            <motion.div variants={fadeInUp} className="d-flex gap-3 flex-wrap">
                                <motion.button whileHover={hoverScale} whileTap={{ scale: 0.95 }} className="hf-btn-primary">
                                    Get a Free Consultation
                                </motion.button>
                                <motion.button whileHover={hoverScale} whileTap={{ scale: 0.95 }} className="hf-btn-ghost">
                                    View Demo
                                </motion.button>
                            </motion.div>
                            <motion.div variants={fadeInUp} className="mt-4 d-flex align-items-center gap-2 text-muted small">
                                <div className="d-flex">
                                    {[1, 2, 3, 4].map(i => (
                                        <div key={i} className="rounded-circle bg-secondary border border-white" style={{ width: 30, height: 30, marginLeft: i > 1 ? -10 : 0 }} />
                                    ))}
                                </div>
                                <span>Trusted by 500+ happy clients</span>
                            </motion.div>
                        </motion.div>

                        <motion.div
                            className="col-lg-6 text-center"
                            initial={{ opacity: 0, x: 50 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.8, delay: 0.2 }}
                            style={{ y: heroY }}
                        >
                            {/* Hero Graphic Placeholder (High Five) */}
                            <motion.div
                                animate={{ y: [0, -20, 0] }}
                                transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                                className="position-relative d-inline-block"
                            >
                                <div className="bg-white rounded-circle shadow-lg d-flex align-items-center justify-content-center position-relative z-2" style={{ width: 300, height: 300 }}>
                                    <div className="text-secondary opacity-50">
                                        {/* Simple SVG Illustration placeholder */}
                                        <svg viewBox="0 0 200 200" width="200" height="200" fill="var(--hf-primary)">
                                            <path d="M60 100 Q 80 50 120 80 T 140 140" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
                                            <circle cx="120" cy="80" r="10" />
                                            <circle cx="60" cy="100" r="10" />
                                            <text x="50" y="180" fontSize="20" fill="#2D3436" fontWeight="bold">HIGH FIVE!</text>
                                        </svg>
                                    </div>
                                </div>
                                {/* Decorative elements */}
                                <motion.div
                                    className="position-absolute bg-warning rounded-circle"
                                    style={{ width: 50, height: 50, top: 0, right: 0, zIndex: 1 }}
                                    animate={{ scale: [1, 1.2, 1] }}
                                    transition={{ repeat: Infinity, duration: 2 }}
                                />
                                <div className="position-absolute bg-info rounded-circle" style={{ width: 30, height: 30, bottom: 20, left: 20, zIndex: 3 }} />
                            </motion.div>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="hf-section bg-white">
                <div className="container">
                    <motion.div
                        className="row g-4"
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        variants={staggerContainer}
                    >
                        {/* Feature 1 */}
                        <div className="col-md-4">
                            <motion.div variants={fadeInUp} className="hf-card h-100 text-center">
                                <div className="d-inline-flex align-items-center justify-content-center bg-danger-subtle text-danger rounded-circle mb-4" style={{ width: 70, height: 70 }}>
                                    <RocketIcon />
                                </div>
                                <h3 className="h4 hf-h3 mb-3">Lightning Fast</h3>
                                <p className="text-muted">Deploy quickly with our pre-built high-performance templates handled by tech wizards.</p>
                            </motion.div>
                        </div>
                        {/* Feature 2 */}
                        <div className="col-md-4">
                            <motion.div variants={fadeInUp} className="hf-card h-100 text-center">
                                <div className="d-inline-flex align-items-center justify-content-center bg-warning-subtle text-warning-emphasis rounded-circle mb-4" style={{ width: 70, height: 70 }}>
                                    <BoltIcon />
                                </div>
                                <h3 className="h4 hf-h3 mb-3">Instant Impact</h3>
                                <p className="text-muted">Bold visuals and punchy copy that grabs attention immediately and doesn't let go.</p>
                            </motion.div>
                        </div>
                        {/* Feature 3 */}
                        <div className="col-md-4">
                            <motion.div variants={fadeInUp} className="hf-card h-100 text-center">
                                <div className="d-inline-flex align-items-center justify-content-center bg-success-subtle text-success rounded-circle mb-4" style={{ width: 70, height: 70 }}>
                                    <HeartIcon />
                                </div>
                                <h3 className="h4 hf-h3 mb-3">Loved by Users</h3>
                                <p className="text-muted">Designed for humans, not just bots. Create experiences your customers actually enjoy.</p>
                            </motion.div>
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* How It Works */}
            <section className="hf-section">
                <div className="container">
                    <div className="text-center mb-5">
                        <h2 className="display-5 hf-h2">Three Steps to Victory</h2>
                        <p className="lead text-muted">A simple process for complex wins.</p>
                    </div>

                    <div className="row text-center position-relative">
                        {/* Connecting Line (Desktop) */}
                        <div className="d-none d-md-block position-absolute top-50 start-0 w-100 border-top border-2 border-dashed z-0" style={{ borderColor: '#e0e0e0', transform: 'translateY(-50%)' }}></div>

                        {[
                            { num: "01", title: "Connect", desc: "Sync your data sources in one click." },
                            { num: "02", title: "Optimize", desc: "AI analyzes and suggests big improvements." },
                            { num: "03", title: "High Five!", desc: "Watch the results roll in and celebrate." }
                        ].map((step, i) => (
                            <div key={i} className="col-md-4 position-relative z-1 mb-4 mb-md-0">
                                <motion.div
                                    className="bg-white rounded-circle shadow-sm d-inline-flex align-items-center justify-content-center mb-3 fw-bold fs-3"
                                    style={{ width: 80, height: 80, border: '4px solid white' }}
                                    whileHover={{ scale: 1.1, backgroundColor: 'var(--hf-primary)', color: 'white' }}
                                    transition={{ type: "spring", stiffness: 300 }}
                                >
                                    {step.num}
                                </motion.div>
                                <h3 className="h4 mt-3">{step.title}</h3>
                                <p className="text-muted px-4">{step.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Strip */}
            <section className="py-5 bg-dark text-white">
                <div className="container text-center">
                    <div className="row justify-content-center">
                        <div className="col-lg-8">
                            <h2 className="mb-4">Ready to start winning?</h2>
                            <p className="lead text-white-50 mb-4">Join the optimization party. No credit card required for the high-five.</p>
                            <motion.button
                                className="hf-btn-primary border-0"
                                style={{ backgroundColor: 'white', color: 'var(--hf-primary)' }}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                Get a Free Consultation
                            </motion.button>
                        </div>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-2 py-md-4 bg-light text-center border-top">
                <div className="container">
                    <p className="small text-muted mb-0" style={{ fontSize: '0.75rem' }}>
                        <span className="d-block d-sm-inline">© 2025 High-Five Look. All rights reserved.</span>
                        <span className="d-none d-sm-inline mx-2">|</span>
                        <span className="d-block d-sm-inline mt-1 mt-sm-0">Made with <span className="text-danger">♥</span></span>
                    </p>
                </div>
                <style>{`
                    @media (max-width: 576px) {
                        footer {
                            padding-top: 0.5rem !important;
                            padding-bottom: 0.5rem !important;
                        }
                        footer p {
                            font-size: 0.7rem !important;
                            line-height: 1.4;
                        }
                    }
                    @media (min-width: 577px) and (max-width: 768px) {
                        footer {
                            padding-top: 0.75rem !important;
                            padding-bottom: 0.75rem !important;
                        }
                        footer p {
                            font-size: 0.725rem !important;
                        }
                    }
                `}</style>
            </footer>
        </div>
    );
}
