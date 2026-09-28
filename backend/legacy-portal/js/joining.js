/**
 * Rexera HR Candidate Onboarding & Digital Policy Agreement Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Onboarding Login Page Logic
  const tokenLoginForm = document.getElementById('token-login-form');
  if (tokenLoginForm) {
    initTokenLoginForm(tokenLoginForm);
  }

  // 2. Onboarding Form Multi-Step Wizard Logic
  const onboardingWizard = document.getElementById('onboarding-wizard-form');
  if (onboardingWizard) {
    initOnboardingWizard(onboardingWizard);
  }
});

/**
 * Onboarding Login Handler (Token + Email OTP Gate)
 */
function initTokenLoginForm(form) {
  const tokenInput = document.getElementById('joining-token-input');
  const stepTokenBox = document.getElementById('step-token-box');
  const stepOtpBox = document.getElementById('step-otp-box');
  const otpCandidateEmailSpan = document.getElementById('otp-candidate-email');
  const debugOtpBadge = document.getElementById('debug-otp-display');

  let validatedToken = '';
  let candidateEmail = '';

  // Auto uppercase token input
  if (tokenInput) {
    tokenInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
  }

  // Submit Token
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = tokenInput.value.trim().toUpperCase();

    if (!token) {
      Toast.warning('Please enter your joining token.');
      return;
    }

    const validateBtn = document.getElementById('btn-validate-token');
    if (validateBtn) {
      validateBtn.disabled = true;
      validateBtn.textContent = 'Verifying Token...';
    }

    try {
      const res = await API.post('/joining/validate-token', { token });

      if (!res.valid) {
        Toast.error(res.message);
        if (validateBtn) {
          validateBtn.disabled = false;
          validateBtn.textContent = 'Verify Token';
        }
        return;
      }

      validatedToken = res.token;
      candidateEmail = res.email;

      Toast.success(res.message);

      // Switch to OTP Verification Step
      if (stepTokenBox) stepTokenBox.style.display = 'none';
      if (stepOtpBox) stepOtpBox.style.display = 'block';
      if (otpCandidateEmailSpan) otpCandidateEmailSpan.textContent = candidateEmail;

      // Auto-focus first OTP box
      const firstOtpDigit = document.querySelector('.otp-digit');
      if (firstOtpDigit) firstOtpDigit.focus();

      // Setup OTP inputs auto-advance
      initOtpInputs();

    } catch (err) {
      Toast.error('Token validation failed: ' + err.message);
      if (validateBtn) {
        validateBtn.disabled = false;
        validateBtn.textContent = 'Verify Token';
      }
    }
  });

  // Verify OTP button
  const btnVerifyOtp = document.getElementById('btn-verify-joining-otp');
  if (btnVerifyOtp) {
    btnVerifyOtp.addEventListener('click', async () => {
      const otpDigits = Array.from(document.querySelectorAll('.otp-digit')).map(i => i.value).join('');

      if (otpDigits.length < 6) {
        Toast.warning('Please enter the full 6-digit verification code.');
        return;
      }

      btnVerifyOtp.disabled = true;
      btnVerifyOtp.textContent = 'Authenticating...';

      try {
        await API.post('/joining/verify-token-otp', { token: validatedToken, otp: otpDigits });
        Toast.success('Identity verified! Redirecting to onboarding form...');

        // Store onboarding session
        sessionStorage.setItem('rexera_onboarding_token', validatedToken);
        sessionStorage.setItem('rexera_onboarding_email', candidateEmail);

        setTimeout(() => {
          window.location.href = '/joining-form.html';
        }, 1000);
      } catch (err) {
        Toast.error('OTP verification failed: ' + err.message);
        btnVerifyOtp.disabled = false;
        btnVerifyOtp.textContent = 'Verify & Enter Portal';
      }
    });
  }

  // Resend OTP button
  const btnResendOtp = document.getElementById('btn-resend-joining-otp');
  if (btnResendOtp) {
    btnResendOtp.addEventListener('click', async () => {
      try {
        await API.post('/otp/send', { email: candidateEmail, purpose: 'onboarding' });
        Toast.success('A new verification code has been dispatched to your email.');
      } catch (err) {
        Toast.error('Failed to resend code: ' + err.message);
      }
    });
  }
}

function initOtpInputs() {
  const digits = document.querySelectorAll('.otp-digit');
  digits.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      if (e.target.value.length === 1 && index < digits.length - 1) {
        digits[index + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        digits[index - 1].focus();
      }
    });

    // Handle copy-paste of 6-digit code
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim();
      if (/^\d{6}$/.test(pasteData)) {
        pasteData.split('').forEach((char, i) => {
          if (digits[i]) digits[i].value = char;
        });
        digits[5].focus();
      }
    });
  });
}

/**
 * Multi-Step Onboarding Wizard
 */
function initOnboardingWizard(form) {
  const token = sessionStorage.getItem('rexera_onboarding_token');
  const email = sessionStorage.getItem('rexera_onboarding_email');

  if (!token) {
    Toast.warning('Please enter your joining token to access the onboarding form.');
    window.location.href = '/joining-login.html';
    return;
  }

  // Set token and email in form fields
  const tokenHidden = document.getElementById('onboard-token');
  const emailInput = document.getElementById('email');
  if (tokenHidden) tokenHidden.value = token;
  if (emailInput && email) emailInput.value = email;

  let currentStep = 1;

  // Step navigation buttons
  const btnNext1 = document.getElementById('btn-wizard-next-1');
  const btnPrev2 = document.getElementById('btn-wizard-prev-2');
  const btnNext2 = document.getElementById('btn-wizard-next-2');
  const btnPrev3 = document.getElementById('btn-wizard-prev-3');

  if (btnNext1) {
    btnNext1.addEventListener('click', () => {
      if (validateStep1()) {
        goToStep(2);
      }
    });
  }

  if (btnPrev2) btnPrev2.addEventListener('click', () => goToStep(1));
  
  if (btnNext2) {
    btnNext2.addEventListener('click', () => {
      if (validateStep2()) {
        goToStep(3);
        // Pre-fill agreement signature name with Full Name
        const nameVal = document.getElementById('full_name')?.value || '';
        const sigInput = document.getElementById('signature_name');
        if (sigInput && !sigInput.value) sigInput.value = nameVal;
      }
    });
  }

  if (btnPrev3) btnPrev3.addEventListener('click', () => goToStep(2));

  // Final Form Submission (Step 3)
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const agreeCheck = document.getElementById('agree_policy');
    const signatureName = document.getElementById('signature_name')?.value.trim();

    if (!agreeCheck || !agreeCheck.checked) {
      Toast.warning('You must read and accept the Rexera HR Policy Agreement.');
      return;
    }

    if (!signatureName) {
      Toast.warning('Please enter your full legal name as your digital signature.');
      return;
    }

    const submitBtn = document.getElementById('btn-wizard-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting Documentation...';
    }

    const payload = {
      token: token,
      full_name: document.getElementById('full_name').value.trim(),
      parent_name: document.getElementById('parent_name').value.trim(),
      date_of_birth: document.getElementById('date_of_birth').value,
      gender: document.getElementById('gender').value,
      marital_status: document.getElementById('marital_status').value,
      nationality: document.getElementById('nationality').value || 'Indian',
      blood_group: document.getElementById('blood_group').value,
      mobile_number: document.getElementById('mobile_number').value.trim(),
      alternate_mobile: document.getElementById('alternate_mobile')?.value.trim() || '',
      email: document.getElementById('email').value.trim(),
      permanent_address: document.getElementById('permanent_address').value.trim(),
      correspondence_address: document.getElementById('correspondence_address').value.trim(),
      aadhaar_number: document.getElementById('aadhaar_number').value.replace(/\s+/g, ''),
      pan_number: document.getElementById('pan_number').value.trim().toUpperCase(),
      emergency_contact_name: document.getElementById('emergency_contact_name').value.trim(),
      emergency_contact_number: document.getElementById('emergency_contact_number').value.trim(),
      emergency_contact_relation: document.getElementById('emergency_contact_relation').value.trim(),
      family_contact: document.getElementById('family_contact')?.value.trim() || '',
      bank_name: document.getElementById('bank_name').value.trim(),
      account_no: document.getElementById('account_no').value.trim(),
      ifsc_code: document.getElementById('ifsc_code').value.trim().toUpperCase(),
      agreement: {
        accepted: true,
        signature_name: signatureName
      }
    };

    try {
      const res = await API.post('/joining/submit-onboarding', payload);
      
      // Clear onboarding session
      sessionStorage.removeItem('rexera_onboarding_token');
      sessionStorage.removeItem('rexera_onboarding_email');

      // Show Success Screen
      showOnboardingSuccess(res);
    } catch (err) {
      Toast.error('Submission failed: ' + err.message);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Accept & Complete Onboarding';
      }
    }
  });
}

function goToStep(stepNumber) {
  document.querySelectorAll('.wizard-step-content').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.step-item').forEach(s => s.classList.remove('active'));

  const activeContent = document.getElementById(`step-${stepNumber}-content`);
  if (activeContent) activeContent.style.display = 'block';

  for (let i = 1; i <= stepNumber; i++) {
    const item = document.getElementById(`step-indicator-${i}`);
    if (item) {
      if (i < stepNumber) {
        item.classList.add('completed');
      } else {
        item.classList.add('active');
        item.classList.remove('completed');
      }
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateStep1() {
  const requiredIds = ['full_name', 'parent_name', 'date_of_birth', 'mobile_number', 'email', 'permanent_address', 'correspondence_address'];
  for (const id of requiredIds) {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) {
      Toast.warning(`Please fill in all mandatory fields.`);
      el?.focus();
      return false;
    }
  }
  return true;
}

function validateStep2() {
  const panInput = document.getElementById('pan_number');
  const aadhaarInput = document.getElementById('aadhaar_number');
  const ifscInput = document.getElementById('ifsc_code');
  const accInput = document.getElementById('account_no');
  const confirmAccInput = document.getElementById('confirm_account_no');

  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  if (!panRegex.test(panInput.value.trim().toUpperCase())) {
    Toast.error('Invalid PAN Number format (Expected 5 letters, 4 digits, 1 letter, e.g. ABCDE1234F)');
    panInput.focus();
    return false;
  }

  const cleanAadhaar = aadhaarInput.value.replace(/[\s-]/g, '');
  if (!/^\d{12}$/.test(cleanAadhaar)) {
    Toast.error('Invalid Aadhaar Number (Must be exactly 12 numeric digits)');
    aadhaarInput.focus();
    return false;
  }

  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  if (!ifscRegex.test(ifscInput.value.trim().toUpperCase())) {
    Toast.error('Invalid IFSC Code format (e.g. HDFC0001024)');
    ifscInput.focus();
    return false;
  }

  if (accInput.value.trim() !== confirmAccInput.value.trim()) {
    Toast.error('Bank Account Numbers do not match.');
    confirmAccInput.focus();
    return false;
  }

  return true;
}

function showOnboardingSuccess(res) {
  const wizardContainer = document.getElementById('onboarding-wizard-container');
  if (!wizardContainer) return;

  wizardContainer.innerHTML = `
    <div class="card" style="text-align: center; padding: 50px 30px;">
      <div style="font-size: 64px; color: var(--success); margin-bottom: 16px;">✓</div>
      <h2 style="font-size: 26px; color: var(--rex-navy); margin-bottom: 10px;">Onboarding Completed Successfully!</h2>
      <p style="font-size: 15px; color: var(--text-muted); max-width: 500px; margin: 0 auto 24px auto;">
        ${res.message}
      </p>
      <div style="background: #f8fafc; border: 1px solid var(--border-light); border-radius: 8px; padding: 18px; max-width: 400px; margin: 0 auto 28px auto;">
        <div style="font-size: 13px; color: var(--text-muted);">Assigned Employee Code</div>
        <div style="font-family: monospace; font-size: 24px; font-weight: 800; color: var(--rex-navy); margin-top: 4px;">
          ${res.employee_code || 'EMP-ACTIVE'}
        </div>
      </div>
      <p style="font-size: 13px; color: var(--text-light);">
        Your credentials and digital policy agreement have been recorded. You may close this window.
      </p>
    </div>
  `;
}
