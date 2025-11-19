import logger from "#config/logger.js"
import { formatValidationError } from "#utils/format.js";
import { signUpSchema } from "#validations/auth.validation.js";

export const signup = async (req, res, next) => {
    try {
        const validationResult = signUpSchema.safeParse(req.body);

        if(!validationResult.success) {
            return res.status(400).json({
                error: "Validation Failded",
                details: formatValidationError(validationResult.error)
            });
        }

        const { name, email, role } = validationResult.data();
    } catch (e) {
        logger.error("Sign-up error", e);

        if(e.message === "User with this email already exists") {
            return res.status(409).json({ error: 'Email already exists' });
        }

        next(e);
    }
}