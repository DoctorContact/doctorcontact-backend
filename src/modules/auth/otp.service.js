import axios from "axios";

export const sendOTP = async (mobile, otp) => {
  try {
    const authKey = process.env.APITXT_AUTH_KEY;
    const templateId = process.env.APITXT_TEMPLATE_ID;

    const params = {
      authkey: authKey,
      mobile: mobile,
      otp: otp,
      channel: "sms",
    };

    if (templateId) params.template_id = templateId;

    const response = await axios.get("https://apitxt.com/api/sendOTP", { params });

    if (response.data.status === "success") {
      return true;
    } else {
      console.error("ApiTxt API Error:", response.data.message);
      return false;
    }
  } catch (error) {
    console.error("OTP Send Error:", error.response?.data || error.message);
    return false;
  }
};