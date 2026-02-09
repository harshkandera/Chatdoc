const parseError = (err) => {
    let msg = typeof err === "string" ? err : err.message || JSON.stringify(err);

    if (typeof err === "string" && err.trim().startsWith("{")) {
       try {
         const parsed = JSON.parse(err);
         if (parsed.error?.message) {
           msg = parsed.error.message;
           if (parsed.error?.status) msg += " " + parsed.error.status;
         }
       } catch (e) {
         // ignore
       }
    }

    if (
      msg.includes("429") ||
      msg.includes("quota") ||
      msg.includes("limit") ||
      msg.includes("RESOURCE_EXHAUSTED")
    ) {
      return "Usage limit exceeded (Google AI). Please check your plan or try again later.";
    }
    return msg;
};

const userError = `{"error":{"code":429,"message":"You exceeded your current quota...","status":"RESOURCE_EXHAUSTED","details":[...]}}`;

console.log("Input:", userError);
console.log("Output:", parseError(userError));

const objError = JSON.parse(userError);
console.log("Input Object:", objError);
console.log("Output Object:", parseError(objError));
