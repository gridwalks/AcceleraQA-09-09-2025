import React from 'react';
import { handleLogin } from '../services/authService';

const features = [
  {
    icon: '⚠️',
    title: '43 Warning Letter Analyses',
    description:
      'Deep-dive breakdowns of FDA warning letters — what went wrong, why it matters, and how to prevent the same findings in your organization.',
  },
  {
    icon: '📚',
    title: 'Curated Bookstore',
    description:
      'A hand-picked library of quality and regulatory books selected by industry veterans. Every title vetted for real-world value.',
  },
  {
    icon: '🤖',
    title: 'AI Learning Tool',
    description:
      'An AI assistant trained on regulatory documents and case study material — ask questions, explore scenarios, and learn by doing.',
  },
  {
    icon: '📝',
    title: 'Case Studies & Blog',
    description:
      'Written material and case studies curated to build the regulatory judgment that textbooks alone can\'t teach.',
  },
];

const AuthScreen = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      {/* Nav */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-white/10">
        <img
          src="/AceleraQA_logo.png"
          alt="AcceleraQA logo"
          width="160"
          height="32"
        />
        <button
          onClick={handleLogin}
          className="px-5 py-2 rounded-lg text-sm font-medium border border-white/20 text-white hover:bg-white/10 transition-colors"
        >
          Sign in
        </button>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
        <span style={{ color: '#818cf8', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Quality &amp; Regulatory Learning
        </span>
        <h1 className="text-4xl font-bold text-white mt-3 mb-5 leading-tight">
          Training the Next Generation<br />of Quality Leaders
        </h1>
        <p className="text-lg text-gray-400 max-w-xl mx-auto mb-8 leading-relaxed">
          AcceleraQA is a learning company built for pharmaceutical quality and regulatory
          professionals. We curate the resources, case studies, and tools that help you build
          real-world regulatory judgment — not just checkbox knowledge.
        </p>
        <button
          onClick={handleLogin}
          className="inline-flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-semibold text-white transition-colors"
          style={{ backgroundColor: '#4F46E5' }}
          onMouseOver={e => e.currentTarget.style.backgroundColor = '#4338CA'}
          onMouseOut={e => e.currentTarget.style.backgroundColor = '#4F46E5'}
        >
          Get started →
        </button>
      </section>

      {/* Features */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {features.map(({ icon, title, description }) => (
            <div
              key={title}
              className="rounded-2xl p-6 transition-colors"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div className="text-2xl mb-4">{icon}</div>
              <h3 className="font-semibold text-white mb-2">{title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section
        className="py-14 px-6 text-center mx-6 mb-16 rounded-2xl"
        style={{ backgroundColor: '#4F46E5' }}
      >
        <h2 className="text-2xl font-bold text-white mb-3">
          Ready to accelerate your regulatory career?
        </h2>
        <p className="text-indigo-200 mb-6 max-w-md mx-auto text-sm">
          Join quality professionals building real expertise through curated resources and AI-powered learning.
        </p>
        <button
          onClick={handleLogin}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-colors"
          style={{ backgroundColor: 'white', color: '#4F46E5' }}
          onMouseOver={e => e.currentTarget.style.backgroundColor = '#EEF2FF'}
          onMouseOut={e => e.currentTarget.style.backgroundColor = 'white'}
        >
          Create an account →
        </button>
      </section>

      <footer className="text-center py-6 text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
        © {new Date().getFullYear()} AcceleraQA. All rights reserved.
      </footer>
    </div>
  );
};

export default AuthScreen;
