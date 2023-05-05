import { NextFunction, Request, Response } from 'express';
import { userLoginDto, userSignupDto } from '../interfaces/DTO';
import *  as UserService from '../services/userLoginService';
import bcrypt from 'bcrypt';
import * as jwt from '../middleware/auth';
import * as redis from 'redis';
import { signUpUser } from '../services/userLoginService';



const redisClient = redis.createClient({
    url: `redis://${process.env.REDIS_USERNAME}:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}/0`,
    legacyMode: true
});


/**
 * @desc 유저 회원 가입
 */
export const userSignup = async (req: Request, res: Response, next: NextFunction) => {

    const { userId, userEmail, userPassword,userNickname }: userSignupDto = req.body;
    const userEmailSelect = await UserService.userEmailSelect(userEmail);
    console.log(userEmailSelect);
    if (userEmailSelect) {
        return res.status(409).json({
            code: 409,
            message: "Id already exists"
        });
    }
    await UserService.signUpUser(userId, userEmail ,userNickname,userPassword);
    return res.status(200).json({
        code: 200,
        message: "user register success"
    });


}



/**
 * 
 * @param req 유저 이메일, 유저 비밀번호 받기
 * @param res 
 * @param next 
 * @returns 1. 404 유저 아이디, 비밀번호 옳지 않음
 *          2. 200 accessToken, refreshToken 발급
 */
export const userLogin = async (req: Request, res: Response, next: NextFunction) => {
    try {
        await redisClient.connect();
        const { userEmail, userPassword }: userLoginDto = req.body;
        const userEmailSelect = await UserService.userEmailSelect(userEmail);
        console.log(userEmailSelect);
        if (userEmailSelect == null || userEmailSelect == undefined) {
            return res.status(404).json({
                code: 404,
                message: "Id can't find"
            });
        }
        const comparePassword = await bcrypt.compare(userPassword, userEmailSelect.password);
        if (!comparePassword) {
            return res.status(419).json({
                code: 419,
                message: "Password can't find"
            });
        }
        const accessToken = "Bearer " + jwt.sign(userEmailSelect.id, userEmailSelect.role);
        const refreshToken = "Bearer " + jwt.refresh();
        await redisClient.v4.set(String(userEmailSelect.id), refreshToken);
        if (userEmailSelect === 1) {
            return res.status(200).json({
                code: 200,
                message: "Ok",
                data: {
                    accessToken,
                    refreshToken
                },
                role: 1
            });
        } else {
            return res.status(200).json({
                code: 200,
                message: "Ok",
                data: {
                    accessToken,
                    refreshToken
                },
                role: 0
            });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({
            "code": 500,
            message: "Server Error"
        });
    } finally {
        await redisClient.disconnect();   
    }
};

/**
 * 
 * @param req  header로부터 accessToken, refreshToken 모두 받거나 accessToken 하나만 받는다.
 * @param res  
 * @param next 
 * @returns 
 *      => accessToken, refreshToken 둘 다 만료 시 재로그인 응답
 *      => accessToken만 만료 시 새로운 accessToken과 기존 refrshToken 응답
 */
export const userReissueToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
            await redisClient.connect();
            const accessToken = (req.headers.access as string).split('Bearer ')[1];
            const authResult = jwt.verify(accessToken);
            const decoded = jwt.decode(accessToken);
            if (req.headers.access && req.headers.refresh) {
                const refreshToken = (req.headers.refresh as string).split('Bearer ')[1];
                if (decoded === null) {
                    return res.status(404).json({
                        code: 404,
                        message: 'No content.',
                    });
                }
                const refreshResult = await jwt.refreshVerify(refreshToken, decoded.id);
                if (authResult.state === false) {
                    if (typeof refreshResult != 'undefined') {
                        if (refreshResult.state === false) {
                            await redisClient.v4.del(String(decoded.id));
                            return res.status(419).json({
                                code: 419,
                                message: 'login again!',
                            });              
                        }                   
                        else {
                            const newAccessToken = jwt.sign(decoded.id, decoded.role);
                            const userRefreshToken = await redisClient.v4.get(String(decoded.id));
                            return res.status(200).json({
                                code: 200,
                                message: "Ok",
                                data: {
                                    accessToken: "Bearer " + newAccessToken,
                                    refreshToken: userRefreshToken
                                },
                            });
                        }
                    }
                }
                else {
                    return res.status(400).json({
                        code: 400,
                        message: 'access token is not expired!',
                    });
                }
            }
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            code: 500,
            message: "Server Error"
        });
    }finally{
        await redisClient.disconnect();
    }
};


/**
 * 
 * @param req  header로 accessToken을 받아옴
 * @param res 
 * @param next 
 * @returns  
 *  1. 로그아웃 완료
 *  2. accessToken 오류
 */
export const userLogout = async (req: Request, res: Response, next: NextFunction) => {
    try {
        await redisClient.connect();
        if (typeof req.headers.access == "string") {
            const accessToken = req.headers.access.split('Bearer ')[1];
            const decode: { id: number } = jwt.decode(accessToken);
            if (decode === null) {
                res.status(404).send({
                    code: 404,
                    message: 'No content.',
                });
            }
            console.log(decode.id);
            await redisClient.v4.del(String(decode.id));
            return res.status(200).send({
                code: 200,
                message: "Logout success"
            });
        }
        else {
            return res.status(403).json({
                "code": 403,
                "message": "strange state"
            });
        }
    } catch (error) {
        return res.status(500).json({
            code: 500,
            message: "Server Error"
        });
    }finally{
        await redisClient.disconnect();
    }
};
