require("dotenv").config();
const sanityClient = require("@sanity/client");
import getKey from "../../lib/keyGen";

const client = sanityClient({
	projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
	dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
	token: process.env.SANITY_W_TOKEN,
	useCdn: false,
});

export default async (req, res) => {
	const doc = JSON.parse(req.body);
	// Update the document with the required values for Sanity
	doc._type = "comment";
	doc._key = getKey();
	doc._id = doc._key;
	doc._createdAt = new Date();

	// If the doc has a parentCommentId, it means it's a child comment
	try {
		if (doc.parentCommentId) {
			// Remove these values from the document, as they're not expected in the database
			const firstParentId = doc.firstParentId;
			const parentCommentId = doc.parentCommentId;
			delete doc.parentCommentId;
			delete doc.firstParentId;

			const childKey = await appendChildComment(
				firstParentId,
				parentCommentId,
				doc
			);
			return res.status(200).json({ message: "Comment Created" });
		} else {
			// If there's no parentCommentId, just create a new comment
			client.create(doc).then(() => {
				return res.status(200).json({ message: "Comment Created" });
			});
		}
	} catch (err) {
		return res.status(500).json({ message: err });
	}
};

async function appendChildComment(
	firstParentId,
	parentCommentId,
	childComment
) {
	// Get the first level parent
	const query = `*[_type == "comment" && _id == "${firstParentId}"][0]`;
	const parentComment = await client.fetch(query).then(r => r);

	// Parent Comment has no children, just create a new Array with the child comment
	if (!parentComment.childComments) {
		parentComment.childComments = [childComment];
	} else if (parentComment._id === parentCommentId) {
		// Parent Comment is a first level comment, so just append the comment
		parentComment.childComments = [
			...parentComment.childComments,
			childComment,
		];
	} else {
		// Parent comment is a level two or more nested comment
		// We need to find the actual parent comment in all nested comments
		const childToUpdate = getChildComment(parentComment, parentCommentId);

		if (!childToUpdate.childComments) {
			// Parent comment has no children, create new Array with the new child
			childToUpdate.childComments = [childComment];
		} else {
			// Parent comment already has some children
			// Add the new childComment, filtering the previous Array to remove the
			childToUpdate.childComments = [
				...childToUpdate.childComments.filter(
					c => c._id !== childComment._id
				),
				childComment,
			];
		}
	}
	// Patch the document
	client
		.patch(parentComment._id)
		.set(parentComment)
		.commit()
		.then(r => console.log("Doc successfully patche. Doc id/key:", r._id));

	// Return the key or the id so we can focus the comment
	return childComment._key;
}

// Recursive function which search every child for other children and returns the child to be modified
function getChildComment(firstParentComment, childCommentId) {
	let returnComment = null;
	firstParentComment?.childComments?.forEach(c => {
		if (c._id == childCommentId) {
			returnComment = c;
		} else if (c.childComments) {
			returnComment = getChildComment(c, childCommentId);
		} else {
			return returnComment;
		}
	});
	return returnComment;
}