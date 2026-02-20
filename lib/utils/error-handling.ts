export function getUserFriendlyErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;

  if (error instanceof Error) {
    const rawMessage = error.message.toLowerCase();

    // Handle common fetch/network errors
    if (
      rawMessage.includes("fetch failed") ||
      rawMessage.includes("network error")
    ) {
      return "Network error: Unable to connect to the server. Please check your connection.";
    }

    // Handle common AI/streaming errors
    if (
      rawMessage.includes("rate limit") ||
      rawMessage.includes("too many requests")
    ) {
      return "You have reached the free tier limit. Please wait a moment and try again.";
    }

    if (rawMessage.includes("abort") || error.name === "AbortError") {
      return "Request was cancelled.";
    }

    // Add specific checks for known app errors here
    if (
      rawMessage.includes("compilation skipped") ||
      rawMessage.includes("incompatible library")
    ) {
      return "An internal rendering error occurred. Please refresh the page.";
    }

    // Default fallback to the actual error message if not generalized
    // You can also just return a generic "An unexpected error occurred" here
    // if you want to completely hide technical details.
    return error.message;
  }

  // Fallback for non-Error objects
  return "An unexpected error occurred. Please try again.";
}
