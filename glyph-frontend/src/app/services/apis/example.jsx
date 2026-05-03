// import { WEBUI_API_BASE_URL } from '$lib/constants';

// export const getMemories = async (token) => {
// 	let error = null;

// 	const res = await fetch(`${WEBUI_API_BASE_URL}/memories/`, {
// 		method: 'GET',
// 		headers: {
// 			Accept: 'application/json',
// 			'Content-Type': 'application/json',
// 			authorization: `Bearer ${token}`
// 		}
// 	})
// 		.then(async (res) => {
// 			if (!res.ok) throw await res.json();
// 			return res.json();
// 		})
// 		.catch((err) => {
// 			error = err.detail;
// 			console.log(err);
// 			return null;
// 		});

// 	if (error) {
// 		throw error;
// 	}

// 	return res;
// };


export const getGPT4Response = async (token) => {

}