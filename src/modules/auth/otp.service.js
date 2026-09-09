import axios from "axios";

export const sendOTP = async (phone, otp) => {
  try {
    console.log(`\n=== OTP Request Initiated for ${phone} : [ ${otp} ] ===`);

    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_TEMPLATE_ID;

    // .env তে ডাটা না থাকলে বা ভুল থাকলে এখানেই আটকে দেবে
    if (!authKey || !templateId) {
      console.error("❌ MSG91 Credentials missing in .env! Cannot send real SMS.");
      return false; 
    }

    // Phone Number Formatting (must include country code, e.g., 91)
    let mobileNumber = phone.replace(/\D/g, '');
    if (mobileNumber.length === 10) mobileNumber = '91' + mobileNumber;

    console.log(`📡 Sending OTP to ${mobileNumber} via MSG91...`);

    // MSG91 OTP API Call
    const response = await axios.post(
      'https://control.msg91.com/api/v5/otp',
      {}, // Body ফাঁকা থাকবে, কারণ OTP param দিয়েই ভ্যালু পাস হচ্ছে
      {
        params: {
          template_id: templateId,
          mobile: mobileNumber,
          otp: otp // MSG91 অটোমেটিক আপনার টেমপ্লেটের ##OTP## কে এটা দিয়ে রিপ্লেস করে দেবে
        },
        headers: {
          'authkey': authKey,
          'Content-Type': 'application/json'
        }
      }
    );

    // MSG91 থেকে সফল উত্তর এসেছে কিনা তা টার্মিনালে দেখাবে
    console.log("✅ MSG91 API Response:", response.data);

    if (response.data.type === 'error') {
      console.error("❌ MSG91 Template/Sender Error:", response.data.message);
      return false;
    }

    return true;
  } catch (error) {
    console.error("❌ MSG91 Network/API Error:", error?.response?.data || error.message);
    return false;
  }
};