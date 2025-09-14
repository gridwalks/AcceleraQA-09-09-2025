import React from 'react';

const Footer = () => {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-gray-50 border-t border-gray-200 text-center py-4 text-sm text-gray-600">
      <p>
        &copy; {year} AcceleraQA, LLC.{' '}
        <a href="/privacy-policy.html" className="text-blue-600 hover:underline">
          Privacy Policy
        </a>
      </p>
    </footer>
  );
};

export default Footer;
